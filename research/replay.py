"""Replay every closed paper position under alternative exit rules.

Reads paper_positions (status = 'closed') and paper_exits, replays each
position's post-entry bars under the stop/exit rules in RULES (the Auto book's
live Kullamägi routine, four lowest-low trails, a percent trail, half off at
+2R, and what actually happened), and writes per-(track, rule) metrics to
research_replay. Nothing about the live ledger (lib/paper-db.ts,
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
day for a position that fills that day (paper-engine.ts: "if (bar.l <= o.stop)"
right after the position is created). A position whose real entry day breached
its own stop closes the same day (closed_date == entry_date) and has zero bars
after entry: every rule books its actual result, since no rule had a session to
act in, which keeps the replay's trade count and totals equal to the paper
page's. Every other closed position's entry-day price action was already
survived in reality, so all the rules agree on day zero and only need to
diverge from the session after — seeded with the pre-entry lows and closes the
live engine also sees (`pre_lows`, `pre_closes`).
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
# lib/config.ts CONFIG.PAPER.KULLAMAGI — the Auto book's live exit since 1.3.7, kept in sync by hand.
KULLAMAGI_PARTIAL_DAY = 4  # entry day = 1
KULLAMAGI_PARTIAL_FRACTION = 0.5
KULLAMAGI_MA = 10

RULES: dict[str, str] = {
    "kullamagi": "Kullamägi: half off day 4, breakeven, 10-day exit",
    "trail_5": "Trail 5-session low",
    "trail_10": "Trail 10-session low",
    "trail_15": "Trail 15-session low",
    "trail_20": "Trail 20-session low",
    "pct_8": "Fixed 8% trail",
    "half_2r": "Sell half at +2R, trail rest",
    "actual": "What actually happened",
}
# The rule each track trades live, so the paper page can say "vs the current rule".
CURRENT_RULE: dict[str, str] = {"auto": "kullamagi", "manual": "trail_10"}


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


def _seed_trail(initial_stop: float, pre_lows: list[float], n: int) -> tuple[float, list[float]]:
    """The trail's starting point, as the live engine sets it on the fill day
    (lib/paper-engine.ts trailLevel after the fill): the lowest low of the last
    n bars *including the sessions before entry and the entry day itself*,
    ratcheted over the initial stop. Without pre-entry lows the window starts
    empty and the stop stays at initial_stop until post-entry lows exist.
    """
    lows = list(pre_lows)
    stop = max(initial_stop, min(lows[-n:])) if lows else initial_stop
    return stop, lows


def _replay_trail(
    bars: pd.DataFrame, entry_price: float, initial_stop: float, shares: int, n: int, pre_lows: list[float]
) -> dict:
    """stop = max(previous stop, lowest low of the last n sessions), ratchet up only.

    The n-session window spans the bars before entry too, like the live engine's
    10-bar lookback — seeding it from post-entry bars only (the bug fixed
    2026-10-25) put the stop at day 1's low after one session, far tighter than
    the rule the book actually trades.
    """
    stop, lows = _seed_trail(initial_stop, pre_lows, n)
    for i, row in enumerate(bars.itertuples(index=False)):
        if row.l <= stop:
            return _combine(entry_price, initial_stop, [(min(row.o, stop), row.date, shares, i + 1)], False)
        lows.append(row.l)
        stop = max(stop, min(lows[-n:]))
    last = bars.iloc[-1]
    return _combine(entry_price, initial_stop, [(last.c, last.date, shares, len(bars))], True)


def _replay_pct(
    bars: pd.DataFrame, entry_price: float, initial_stop: float, shares: int, pct: float, pre_closes: list[float]
) -> dict:
    """stop = max(previous stop, highest close since entry * (1 - pct)), ratchet up only.

    The peak is seeded at the entry day's close (the last of `pre_closes`), as
    the live engine seeds peakClose at the fill; it falls back to entry_price
    when no pre-entry closes were supplied. The stop itself first moves after
    the first post-entry session, as the manual percent trail does.
    """
    stop = initial_stop
    peak_close = pre_closes[-1] if pre_closes else entry_price
    for i, row in enumerate(bars.itertuples(index=False)):
        if row.l <= stop:
            return _combine(entry_price, initial_stop, [(min(row.o, stop), row.date, shares, i + 1)], False)
        peak_close = max(peak_close, row.c)
        stop = max(stop, peak_close * (1 - pct))
    last = bars.iloc[-1]
    return _combine(entry_price, initial_stop, [(last.c, last.date, shares, len(bars))], True)


def _replay_half_2r(
    bars: pd.DataFrame, entry_price: float, initial_stop: float, shares: int, pre_lows: list[float]
) -> dict:
    """Sell half at entry + 2R (fill at max(open, level)) on the first session whose
    high reaches it, then trail the remaining half with the 10-session-low trail.
    The trail runs unconditionally from day one, exactly as trail_10 would (same
    pre-entry seeding), so a position that never reaches the target is identical
    to trail_10 on the full size.

    "Half" follows the manual-sell convention in lib/paper-db.ts requestSell:
    max(1, floor(shares / 2)) sold, the rest kept.
    """
    risk = entry_price - initial_stop
    target = entry_price + 2 * risk if risk > 0 else None
    half = max(1, shares // 2)
    remaining = shares - half
    stop, lows = _seed_trail(initial_stop, pre_lows, 10)
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


def _replay_kullamagi(
    bars: pd.DataFrame, entry_price: float, initial_stop: float, shares: int, pre_closes: list[float]
) -> dict:
    """The Auto book's live exit (lib/paper-engine.ts processSession, kullamagi
    branch): stop at `initial_stop`; on day KULLAMAGI_PARTIAL_DAY (entry day = 1),
    if the previous close is above entry, sell the partial fraction at the open
    and raise the stop to breakeven; after any close under the KULLAMAGI_MA-session
    average, sell what is left at the next open. `pre_closes` are the closes up to
    and including the entry day (oldest first) so the average has history from
    the first post-entry session; without them it is taken over what exists.
    """
    stop = initial_stop
    held = shares
    legs: list[tuple[float, Any, int, int | None]] = []
    closes = list(pre_closes)
    pending = False
    prev_close = closes[-1] if closes else entry_price
    for i, row in enumerate(bars.itertuples(index=False)):
        day = i + 2  # bars start the session after entry
        if pending:
            legs.append((row.o, row.date, held, i + 1))
            return _combine(entry_price, initial_stop, legs, False)
        if day == KULLAMAGI_PARTIAL_DAY and held == shares and prev_close > entry_price:
            sell = int(held * KULLAMAGI_PARTIAL_FRACTION)
            if sell > 0:
                legs.append((row.o, row.date, sell, i + 1))
                held -= sell
            stop = max(stop, entry_price)
        if row.l <= stop:
            legs.append((min(row.o, stop), row.date, held, i + 1))
            return _combine(entry_price, initial_stop, legs, False)
        closes.append(row.c)
        prev_close = row.c
        window = closes[-KULLAMAGI_MA:]
        if row.c < sum(window) / len(window):
            pending = True
    last = bars.iloc[-1]
    legs.append((last.c, last.date, held, len(bars)))
    return _combine(entry_price, initial_stop, legs, True)


def replay_position(
    bars: pd.DataFrame,
    entry_price: float,
    initial_stop: float,
    shares: int,
    rule: str,
    pre_closes: list[float] | None = None,
    pre_lows: list[float] | None = None,
) -> dict:
    """Replay one closed position from the session after entry under `rule`.

    `bars` must be that ticker's sessions strictly after entry_date, columns
    date, o, h, l, c (any order, ascending or not — this sorts by date). Mirrors
    lib/paper-engine.ts: a stop-out fills at min(open, stop); a target fills at
    max(open, target). `rule` is one of kullamagi, trail_5/10/15/20, pct_8,
    half_2r. `pre_closes` and `pre_lows` are the closes and lows of the sessions
    up to and including the entry day, oldest first: the kullamagi rule's
    moving average and the percent trail's peak read the closes, the lowest-low
    trails seed their window from the lows. Leaving them out reproduces a
    position with no history before entry.

    Returns a dict with exit_price, exit_date, hold (sessions after entry to
    the exit), r ((exit - entry) / (entry - initial_stop), share-weighted
    across legs for half_2r), pnl (dollars, using `shares`), and mtm (True when
    no rule ever exited and the position was marked to the last close).
    """
    if bars.empty:
        raise ValueError("replay_position needs at least one session after entry")
    bars = bars.sort_values("date").reset_index(drop=True)
    closes = pre_closes or []
    lows = pre_lows or []
    if rule == "kullamagi":
        return _replay_kullamagi(bars, entry_price, initial_stop, shares, closes)
    if rule.startswith("trail_"):
        return _replay_trail(bars, entry_price, initial_stop, shares, int(rule.split("_", 1)[1]), lows)
    if rule == "pct_8":
        return _replay_pct(bars, entry_price, initial_stop, shares, 0.08, closes)
    if rule == "half_2r":
        return _replay_half_2r(bars, entry_price, initial_stop, shares, lows)
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
    """Replay every closed paper position under the rules in RULES and
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
    # 35 calendar days (~24 sessions) before the first entry: the 20-session trail
    # seeds its window from the bars before entry, the kullamagi average needs ten closes.
    since = (pd.Timestamp(positions["entry_date"].min()) - pd.Timedelta(days=35)).date().isoformat()
    bars = load_bars(conn, tickers=tickers, since=since)

    rows_by_track: dict[str, list[dict]] = {"auto": [], "manual": []}
    for pos in positions.itertuples():
        entry_date = pd.Timestamp(pos.entry_date)
        own = bars[bars["ticker"] == pos.ticker]
        pos_bars = own[own["date"] > entry_date].sort_values("date")
        pre = own[own["date"] <= entry_date].sort_values("date")
        pre_closes = pre["c"].astype(float).tolist()[-KULLAMAGI_MA:]
        pre_lows = pre["l"].astype(float).tolist()[-20:]
        pos_exits = exits[exits["position_id"] == pos.id]
        total_shares = int(pos.shares) + int(pos_exits["shares"].sum())
        if total_shares <= 0 or pos_exits.empty:
            continue  # malformed: a closed position must have exited some shares
        actual = _actual_result(pos_bars, pos_exits, pos.entry_price, pos.initial_stop)
        for rule in RULES:
            if rule == "actual" or pos_bars.empty:
                # A position stopped on its own entry day has no session for any rule to
                # differ on, so every rule books what actually happened — keeping the
                # replay's trade count and totals equal to the paper page's.
                result = actual
            else:
                result = replay_position(pos_bars, pos.entry_price, pos.initial_stop, total_shares, rule, pre_closes, pre_lows)
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
                        CURRENT_RULE.get(track) == rule,
                        ctx.scan_date,
                    )
                )
            )

    cols = ["track", "rule", "label", "avg_r", "win_rate", "max_dd", "avg_hold", "total_pnl", "trades", "is_current", "as_of"]
    replace_table(conn, "research_replay", cols, out_rows)

    auto_n = sum(1 for r in rows_by_track["auto"] if r["rule"] == "actual")
    manual_n = sum(1 for r in rows_by_track["manual"] if r["rule"] == "actual")
    return f"{auto_n} auto / {manual_n} manual closed trades replayed under {len(RULES)} rules"
