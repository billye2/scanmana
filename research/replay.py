"""Replay every closed paper position under alternative exit rules.

Reads paper_positions (status = 'closed') and paper_exits, replays each
position's post-entry bars under seven stop/exit rules, and writes per-(track,
rule) metrics to research_replay. Nothing about the live ledger (lib/paper-db.ts,
lib/paper-engine.ts) is touched or re-decided; this is read-only research on
top of it.

Fill/stop semantics are mirrored from lib/paper-engine.ts processSession():
a stop-out fills at min(open, stop) — a gap below the stop fills at the open,
never at a friendlier price (paper-engine.ts lines ~160-166 and ~239-246); a
buy-stop-style target fills at max(open, trigger) (paper-engine.ts line 194).
Trails ratchet up only (paper-engine.ts trailLevel/lines ~171-172).

`replay_position` only ever sees bars strictly after entry_date (by contract —
see its docstring), so the entry session itself cannot exit a position in this
replay, even though the live engine *does* evaluate the stop on the entry/fill
day for a position that fills that day (paper-engine.ts lines 239-246: "if
(bar.l <= o.stop)" right after the position is created). That is not a gap in
this module: a position whose real entry day breached its own stop closes the
same day (closed_date == entry_date) and so has zero bars after entry — it is
skipped by the "fewer than 1 session of bars after entry" rule below, for every
rule including 'actual'. Every other closed position's entry-day price action
was already survived in reality, so all seven rules agree on day zero and only
need to diverge from the session after.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
import psycopg

from .db import load_bars, pyval, read_df, replace_table
from .util import JobContext

# lib/config.ts CONFIG.PAPER.MANUAL_START_CASH — Python can't import the TS
# config, so this is kept in sync by hand.
MANUAL_START_CASH = 10_000

RULES: dict[str, str] = {
    "trail_5": "Trail 5-session low",
    "trail_10": "Trail 10-session low",
    "trail_15": "Trail 15-session low",
    "trail_20": "Trail 20-session low",
    "pct_8": "Fixed 8% trail",
    "half_2r": "Sell half at +2R, trail rest",
    "actual": "What actually happened",
}


def _combine(
    entry_price: float, initial_stop: float, legs: list[tuple[float, Any, int, int | None]], mtm: bool
) -> dict:
    """Fold one or more (price, date, shares, hold) exit legs into one result.

    r is share-weighted across legs (needed for half_2r); pnl and the returned
    exit_price/exit_date/hold come from the last leg filled.
    """
    risk = entry_price - initial_stop
    total = sum(sh for _, _, sh, _ in legs)
    pnl = sum((px - entry_price) * sh for px, _, sh, _ in legs)
    r = sum(((px - entry_price) / risk) * sh for px, _, sh, _ in legs) / total if risk > 0 and total else 0.0
    px, dt, _, hold = legs[-1]
    return {"exit_price": float(px), "exit_date": dt, "hold": int(hold), "r": float(r), "pnl": float(pnl), "mtm": bool(mtm)}


def _replay_trail(bars: pd.DataFrame, entry_price: float, initial_stop: float, shares: int, n: int) -> dict:
    """stop = max(previous stop, lowest low of the last n completed sessions), ratchet up only."""
    stop = initial_stop
    lows: list[float] = []
    for i, row in enumerate(bars.itertuples(index=False)):
        if row.l <= stop:
            return _combine(entry_price, initial_stop, [(min(row.o, stop), row.date, shares, i + 1)], False)
        lows.append(row.l)
        stop = max(stop, min(lows[-n:]))
    last = bars.iloc[-1]
    return _combine(entry_price, initial_stop, [(last.c, last.date, shares, len(bars))], True)


def _replay_pct(bars: pd.DataFrame, entry_price: float, initial_stop: float, shares: int, pct: float) -> dict:
    """stop = max(previous stop, highest close since entry * (1 - pct)), ratchet up only.

    "Since entry" is seeded at entry_price: bars passed in start strictly after
    entry_date, so the entry day's own close is not available here.
    """
    stop = initial_stop
    peak_close = entry_price
    for i, row in enumerate(bars.itertuples(index=False)):
        if row.l <= stop:
            return _combine(entry_price, initial_stop, [(min(row.o, stop), row.date, shares, i + 1)], False)
        peak_close = max(peak_close, row.c)
        stop = max(stop, peak_close * (1 - pct))
    last = bars.iloc[-1]
    return _combine(entry_price, initial_stop, [(last.c, last.date, shares, len(bars))], True)


def _replay_half_2r(bars: pd.DataFrame, entry_price: float, initial_stop: float, shares: int) -> dict:
    """Sell half at entry + 2R (fill at max(open, level)) on the first session whose
    high reaches it, then trail the remaining half with the 10-session-low trail.
    The trail runs unconditionally from day one, exactly as trail_10 would, so a
    position that never reaches the target is identical to trail_10 on the full size.

    "Half" follows the manual-sell convention in lib/paper-db.ts requestSell:
    max(1, floor(shares / 2)) sold, the rest kept.
    """
    risk = entry_price - initial_stop
    target = entry_price + 2 * risk if risk > 0 else None
    half = max(1, shares // 2)
    remaining = shares - half
    stop = initial_stop
    lows: list[float] = []
    sold = False
    legs: list[tuple[float, Any, int, int | None]] = []
    for i, row in enumerate(bars.itertuples(index=False)):
        held = remaining if sold else shares
        if row.l <= stop:
            legs.append((min(row.o, stop), row.date, held, i + 1))
            return _combine(entry_price, initial_stop, legs, False)
        if not sold and target is not None and row.h >= target:
            legs.append((max(row.o, target), row.date, half, i + 1))
            sold = True
            if remaining == 0:
                return _combine(entry_price, initial_stop, legs, False)
        lows.append(row.l)
        stop = max(stop, min(lows[-10:]))
    last = bars.iloc[-1]
    held = remaining if sold else shares
    legs.append((last.c, last.date, held, len(bars)))
    return _combine(entry_price, initial_stop, legs, True)


def replay_position(bars: pd.DataFrame, entry_price: float, initial_stop: float, shares: int, rule: str) -> dict:
    """Replay one closed position from the session after entry under `rule`.

    `bars` must be that ticker's sessions strictly after entry_date, columns
    date, o, h, l, c (any order, ascending or not — this sorts by date). Mirrors
    lib/paper-engine.ts: a stop-out fills at min(open, stop); a target fills at
    max(open, target). `rule` is one of trail_5/10/15/20, pct_8, half_2r.

    Returns a dict with exit_price, exit_date, hold (sessions after entry to
    the exit), r ((exit - entry) / (entry - initial_stop), share-weighted
    across legs for half_2r), pnl (dollars, using `shares`), and mtm (True when
    no rule ever exited and the position was marked to the last close).
    """
    if bars.empty:
        raise ValueError("replay_position needs at least one session after entry")
    bars = bars.sort_values("date").reset_index(drop=True)
    if rule.startswith("trail_"):
        return _replay_trail(bars, entry_price, initial_stop, shares, int(rule.split("_", 1)[1]))
    if rule == "pct_8":
        return _replay_pct(bars, entry_price, initial_stop, shares, 0.08)
    if rule == "half_2r":
        return _replay_half_2r(bars, entry_price, initial_stop, shares)
    raise ValueError(f"unknown replay rule: {rule!r}")


def _actual_result(bars: pd.DataFrame, exits: pd.DataFrame, entry_price: float, initial_stop: float) -> dict:
    """What really happened, from the stored paper_exits — mirrors realized() in
    lib/paper-engine.ts (pnl and R over every exit leg, share-weighted).
    `bars` (that ticker's sessions strictly after entry_date) is used only to
    count hold = sessions from entry_date to the last exit_date.
    """
    legs: list[tuple[float, Any, int, int | None]] = [
        (float(row.exit_price), row.exit_date, int(row.shares), None)
        for row in exits.sort_values("exit_date").itertuples(index=False)
    ]
    last_exit_date = pd.Timestamp(legs[-1][1])
    hold = int((bars["date"] <= last_exit_date).sum())
    legs[-1] = (legs[-1][0], legs[-1][1], legs[-1][2], hold)
    return _combine(entry_price, initial_stop, legs, False)


def summarize(results: list[dict]) -> dict:
    """Per-(track, rule) metrics over result dicts, each with r, pnl, hold, entry_date.

    max_dd is the worst peak-to-trough drawdown of the cumulative $ P&L path in
    entry-date order, expressed as a (negative-or-zero) fraction of
    MANUAL_START_CASH.
    """
    n = len(results)
    if n == 0:
        return {"trades": 0, "avg_r": None, "win_rate": None, "avg_hold": None, "total_pnl": None, "max_dd": None}
    rs = [r["r"] for r in results]
    pnls = [r["pnl"] for r in results]
    holds = [r["hold"] for r in results]
    ordered = sorted(results, key=lambda r: r["entry_date"])
    cum = peak = max_dd = 0.0
    for r in ordered:
        cum += r["pnl"]
        peak = max(peak, cum)
        max_dd = min(max_dd, cum - peak)
    return {
        "trades": n,
        "avg_r": sum(rs) / n,
        "win_rate": sum(1 for r in rs if r > 0) / n,
        "avg_hold": sum(holds) / n,
        "total_pnl": sum(pnls),
        "max_dd": max_dd / MANUAL_START_CASH,
    }


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    """Replay every closed paper position under the seven rules in RULES and
    write research_replay (track, rule) rows. Idempotent: replace_table wipes
    and refills the whole table each run."""
    positions = read_df(
        conn,
        """SELECT id, user_id, track, ticker, entry_date::text AS entry_date, entry_price,
                  shares, initial_stop, closed_date::text AS closed_date
           FROM paper_positions WHERE status = 'closed' ORDER BY track, entry_date, id""",
    )
    if positions.empty:
        return "no closed trades yet"

    ids = positions["id"].tolist()
    exits = read_df(
        conn,
        """SELECT position_id, exit_date::text AS exit_date, exit_price, shares, reason
           FROM paper_exits WHERE position_id = ANY(%s) ORDER BY position_id, exit_date, id""",
        [ids],
    )
    tickers = sorted(positions["ticker"].unique().tolist())
    since = positions["entry_date"].min()
    bars = load_bars(conn, tickers=tickers, since=since)

    rows_by_track: dict[str, list[dict]] = {"auto": [], "manual": []}
    for pos in positions.itertuples():
        entry_date = pd.Timestamp(pos.entry_date)
        pos_bars = bars[(bars["ticker"] == pos.ticker) & (bars["date"] > entry_date)].sort_values("date")
        if pos_bars.empty:
            continue  # 0 sessions after entry: the entry day itself already closed it out
        pos_exits = exits[exits["position_id"] == pos.id]
        total_shares = int(pos.shares) + int(pos_exits["shares"].sum())
        if total_shares <= 0 or pos_exits.empty:
            continue  # malformed: a closed position must have exited some shares
        for rule in RULES:
            if rule == "actual":
                result = _actual_result(pos_bars, pos_exits, pos.entry_price, pos.initial_stop)
            else:
                result = replay_position(pos_bars, pos.entry_price, pos.initial_stop, total_shares, rule)
            rows_by_track[pos.track].append({**result, "rule": rule, "entry_date": pos.entry_date})

    out_rows = []
    for track, results in rows_by_track.items():
        for rule, label in RULES.items():
            metrics = summarize([r for r in results if r["rule"] == rule])
            if metrics["trades"] == 0:
                continue
            out_rows.append(
                tuple(
                    pyval(v)
                    for v in (
                        track,
                        rule,
                        label,
                        metrics["avg_r"],
                        metrics["win_rate"],
                        metrics["max_dd"],
                        metrics["avg_hold"],
                        metrics["total_pnl"],
                        metrics["trades"],
                        rule == "trail_10" and track == "auto",
                        ctx.scan_date,
                    )
                )
            )

    cols = ["track", "rule", "label", "avg_r", "win_rate", "max_dd", "avg_hold", "total_pnl", "trades", "is_current", "as_of"]
    replace_table(conn, "research_replay", cols, out_rows)

    auto_n = sum(1 for r in rows_by_track["auto"] if r["rule"] == "actual")
    manual_n = sum(1 for r in rows_by_track["manual"] if r["rule"] == "actual")
    return f"{auto_n} auto / {manual_n} manual closed trades replayed under {len(RULES)} rules"
