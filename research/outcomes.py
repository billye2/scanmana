"""Outcome labeler: what happened in the 20 sessions after each scan_history row.

For every (date, ticker) the loose screen recorded, look forward and write
research_outcomes: did the close clear the level within 10 sessions, the
best/worst close at 5/10/20 sessions, and the R-multiple of the auto-track
trade. The level is the box top when boxed, else the Livermore pivot when it
is still overhead, else the highest high of the 20 sessions up to the scan (a
name already past its pivot has to make a fresh high to count). Three trades
are scored per boxed row: r_at_exit is the pre-1.3.7 auto plan (buy stop at the
box top, stop at the box bottom, 10-session-low trail); k_r is the plan the
Auto book trades now (the open after the first close above the box within ten
sessions, stop at that day's low, Kullamägi's exits from research/replay.py —
the same function the replay row runs); bs_r is the non-watcher's version (a
resting buy-stop at the box top, stop one ADR under the fill, the same exits).
k_stop_adr is the next-open stop's width in ADR units. Rows are re-labelled
until 20 sessions have passed (complete = true), then left alone.

Follow-through paths (1.7.7, R2 of the Python-studies plan): for every boxed
Wait deck row the next-open plan entered, research_paths holds day 1..PATH_DAYS
from the entry session (day 1 = the entry day, as the replay counts it): gain =
close / entry - 1, low = the lowest low so far / entry - 1 — the raw move with
no exit applied, so the exit routine can be judged against it. path_days on the
outcome row counts the days written; a row whose path is short of PATH_DAYS is
re-labelled nightly until the bars reach that far, past its own 20-session
window if need be.

Exit sweep (1.7.9, R4): on the same rows, once the path is full, exit_grid
holds the R of every cell of research/replay.py EXIT_GRID (partial day × exit
MA × breakeven) on the twenty sessions from the entry — the same entry and
stop as k_r, one list in the grid's order. research/sweep.py aggregates it.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
import psycopg

from .db import load_bars, pyval, read_df, write_rows
from .replay import EXIT_GRID, KULLAMAGI_MA, _replay_kullamagi, exit_grid_r
from .util import JobContext

HORIZON = 20
BREAK_WINDOW = 10
TRAIL = 10  # CONFIG.PAPER.TRAIL_LOOKBACK
HIGH_WINDOW = 20  # sessions (ending on the scan day) whose highest high is the fallback level
CHUNK = 250  # tickers per bars query
PLAN_SHARES = 100  # a share count the day-4 half can split; R is per share so the number does not matter

PLAN_COLUMNS = ["k_entry_day", "k_stop_adr", "k_r", "bs_entry_day", "bs_stop_adr", "bs_r"]
# Bumped when the plan columns' meaning changes: rows written under an older (or no)
# version are re-labelled by the nightly run, a chunk at a time within its budget, so
# a new column back-fills the whole history without a forced Refresh.
PLAN_VERSION = 1
PATH_DAYS = 20
PATH_COLUMNS = ["date", "ticker", "day", "gain", "low"]
COLUMNS = [
    "date", "ticker", "level", "broke_10d", "broke_day",
    "mfe_5", "mfe_10", "mfe_20", "mae_5", "mae_10", "mae_20",
    "r_at_exit", "filled", "sessions_after", "complete",
    *PLAN_COLUMNS, "plan_v", "path_days", "exit_grid",
]
EXIT_CELLS = len(EXIT_GRID)
EXIT_MA_MAX = max(ma for _, ma, _ in EXIT_GRID)  # closes of history the longest average needs
COMPLETE_COL = COLUMNS.index("complete")
PATH_DAYS_COL = COLUMNS.index("path_days")


def follow_path(frame: pd.DataFrame, entry: float, days: int = PATH_DAYS) -> list[tuple[int, float, float]]:
    """The follow-through from `entry` over `frame` (columns l, c), whose first row
    is the entry session: (day, gain, low) for day 1..min(days, len(frame)),
    gain = close / entry - 1, low = min(low_1..day) / entry - 1. Pure."""
    if entry <= 0 or frame.empty:
        return []
    c = frame["c"].to_numpy(dtype=float)[:days]
    lo = np.minimum.accumulate(frame["l"].to_numpy(dtype=float)[:days])
    return [(d + 1, float(c[d] / entry - 1), float(lo[d] / entry - 1)) for d in range(len(c))]


def in_path_study(rank: Any, boxed: bool, verdict: Any, close: float, box_top: float | None) -> bool:
    """The population the paths describe: boxed Wait deck rows resting under the
    box top on scan night — the same rows the plan card on /studies scores."""
    return rank is not None and boxed and verdict == "wait" and box_top is not None and close <= box_top


def _plan_r(frame: pd.DataFrame, start: int, entry: float, stop: float, pre_closes: list[float], n: int) -> float | None:
    """R of the Auto book's exit from `entry` / `stop` over frame.iloc[start:], the
    sessions after the entry day. None while the trade is still open inside an
    incomplete window; marked to the last close once the window is complete."""
    rest = frame.iloc[start:]
    if rest.empty:
        return float((float(frame["c"].iloc[start - 1]) - entry) / (entry - stop)) if n >= HORIZON else None
    res = _replay_kullamagi(rest, entry, stop, PLAN_SHARES, pre_closes)
    if res["mtm"] and n < HORIZON:
        return None
    return float(res["r"])


def kullamagi_plans(
    after: pd.DataFrame, scan_close: float, box_top: float | None, adr: float | None, pre_closes: list[float] | None
) -> dict[str, Any]:
    """The two night-before entries on one boxed row, from the sessions after the
    scan (columns o,h,l,c; `date` optional). Pure.

    Next open (the Auto book, lib/paper-engine.ts armDecisions): the first close
    above the box top within BREAK_WINDOW is the breakout day; entry at the next
    session's open, stop at the breakout day's low; the fill is cancelled when
    that open is at or under the stop; a low at or under the stop on the entry
    day is a same-day stop-out (−1R), as the engine books it. A card already
    above its box on scan night is never armed ("broke out earlier"), so both
    plans are None for it. Resting buy-stop: filled on the first session whose
    high reaches the box top, at max(open, top), stop one ADR under the fill.
    `adr` is a fraction (the card's scan-night ADR); without it the width and
    the buy-stop plan are None. `pre_closes` are the closes up to and including
    the scan day, so the 10-day average has history from the first session."""
    out: dict[str, Any] = {k: None for k in PLAN_COLUMNS}
    n = len(after)
    if n == 0 or box_top is None or box_top <= 0 or scan_close > box_top:
        return out
    frame = after if "date" in after.columns else after.assign(date=np.arange(n))
    o = frame["o"].to_numpy(dtype=float)
    h = frame["h"].to_numpy(dtype=float)
    lo = frame["l"].to_numpy(dtype=float)
    c = frame["c"].to_numpy(dtype=float)
    closes = list(pre_closes or [])

    idx = np.flatnonzero(c[:BREAK_WINDOW] > box_top)
    if idx.size:
        b = int(idx[0])
        if b + 1 < n:
            entry, stop = float(o[b + 1]), float(lo[b])
            if entry > stop:
                out["k_entry_day"] = b + 2
                if adr:
                    out["k_stop_adr"] = float((entry - stop) / entry / adr)
                out["k_r"] = -1.0 if lo[b + 1] <= stop else _plan_r(frame, b + 2, entry, stop, closes + c[: b + 2].tolist(), n)

    if adr:
        for j in range(min(n, BREAK_WINDOW)):
            if h[j] >= box_top:
                fill = float(max(o[j], box_top))
                stop = fill * (1 - adr)
                out["bs_entry_day"] = j + 1
                out["bs_stop_adr"] = 1.0
                out["bs_r"] = -1.0 if lo[j] <= stop else _plan_r(frame, j + 1, fill, stop, closes + c[: j + 1].tolist(), n)
                break
    return out


def label_one(
    after: pd.DataFrame,
    scan_close: float,
    level: float | None,
    box_top: float | None,
    box_bottom: float | None,
    adr: float | None = None,
    pre_closes: list[float] | None = None,
) -> dict[str, Any]:
    """Label one scan row from the sessions strictly after it (columns o,h,l,c). Pure.
    `adr` (a fraction) and `pre_closes` feed `kullamagi_plans`; without them the
    plan columns stay None except the next-open entry day and R."""
    n = len(after)
    o = after["o"].to_numpy(dtype=float)
    h = after["h"].to_numpy(dtype=float)
    lo = after["l"].to_numpy(dtype=float)
    c = after["c"].to_numpy(dtype=float)
    out: dict[str, Any] = {
        "level": level, "broke_10d": None, "broke_day": None,
        "mfe_5": None, "mfe_10": None, "mfe_20": None, "mae_5": None, "mae_10": None, "mae_20": None,
        "r_at_exit": None, "filled": None, "sessions_after": int(n), "complete": bool(n >= HORIZON),
        **{k: None for k in PLAN_COLUMNS}, "plan_v": PLAN_VERSION, "path_days": 0, "exit_grid": None,
    }
    if n == 0:
        return out
    if box_top is not None:
        out.update(kullamagi_plans(after, scan_close, box_top, adr, pre_closes))

    # Breakout: first close above the level within BREAK_WINDOW sessions.
    if level is not None and level > 0:
        win = c[:BREAK_WINDOW]
        idx = np.flatnonzero(win > level)
        if idx.size:
            out["broke_10d"] = True
            out["broke_day"] = int(idx[0]) + 1
        elif n >= BREAK_WINDOW:
            out["broke_10d"] = False

    # Excursions relative to the scan-night close.
    if scan_close > 0:
        for k in (5, 10, 20):
            if n >= k:
                out[f"mfe_{k}"] = float(c[:k].max() / scan_close - 1)
                out[f"mae_{k}"] = float(c[:k].min() / scan_close - 1)

    # Auto-track trade: buy stop at the box top, stop at the box bottom, 10-low trail.
    if box_top is not None and box_bottom is not None and box_top > box_bottom > 0:
        fill_idx = None
        for j in range(n):
            if h[j] >= box_top:
                fill_idx = j
                break
        if fill_idx is None:
            out["filled"] = False if n >= HORIZON else None
        else:
            entry = max(o[fill_idx], box_top)
            risk = entry - box_bottom
            out["filled"] = True
            if risk > 0:
                stop = box_bottom
                exit_px = None
                for j in range(fill_idx + 1, n):
                    if lo[j] <= stop:
                        exit_px = min(o[j], stop)
                        break
                    trail_from = max(0, j - TRAIL + 1)
                    stop = max(stop, float(lo[trail_from : j + 1].min()))
                if exit_px is None and n >= HORIZON:
                    exit_px = c[n - 1]  # marked to the last close of the window
                if exit_px is not None:
                    out["r_at_exit"] = float((exit_px - entry) / risk)
    return out


def _pending_rows(conn: psycopg.Connection, force: bool) -> pd.DataFrame:
    # A path-study row (boxed Wait deck row the plan entered) stays pending until its
    # path reaches PATH_DAYS, which can be up to ten sessions after its outcome window.
    short_path = (
        "(h.rank IS NOT NULL AND h.boxed AND h.verdict = 'wait' AND h.close <= h.box_top"
        f" AND o.k_entry_day IS NOT NULL AND (COALESCE(o.path_days, 0) < {PATH_DAYS} OR o.exit_grid IS NULL))"
    )
    where = "" if force else f"WHERE o.date IS NULL OR NOT o.complete OR o.plan_v IS DISTINCT FROM {PLAN_VERSION} OR {short_path}"
    return read_df(
        conn,
        f"""SELECT h.date, h.ticker, h.close, h.boxed, h.box_top, h.box_bottom, h.pivot, h.adr_pct, h.rank, h.verdict
            FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker) {where}
            ORDER BY h.ticker, h.date""",
    )


def breakout_level(scan_close: float, boxed: bool, box_top: float | None, pivot: float | None, high_20: float | None) -> float | None:
    """The level a name must close above to count as broken out. Pure."""
    if boxed and box_top is not None:
        return box_top
    if pivot is not None and pivot > scan_close:
        return pivot
    if high_20 is not None and high_20 > 0:
        return max(high_20, scan_close)
    return None


def label_frame(rows: pd.DataFrame, bars: pd.DataFrame) -> tuple[list[list[Any]], list[list[Any]]]:
    """Label every row of `rows` (one ticker or many) against `bars`. Pure.
    Returns (outcome rows in COLUMNS order, path rows in PATH_COLUMNS order).

    `bars` should start at least HIGH_WINDOW sessions before the earliest row
    so the fallback level (20-session high) has its history. Paths need `rank`
    and `verdict` on the rows (rows without them get no path)."""
    out: list[list[Any]] = []
    paths: list[list[Any]] = []
    if rows.empty or bars.empty:
        return out, paths
    bars = bars.sort_values(["ticker", "date"])
    for ticker, grp in rows.groupby("ticker", sort=False):
        tb = bars[bars["ticker"] == ticker]
        if tb.empty:
            continue
        dates = tb["date"].to_numpy(dtype="datetime64[ns]")
        for r in grp.itertuples(index=False):
            d = np.datetime64(pd.Timestamp(r.date), "ns")
            i = int(np.searchsorted(dates, d))
            if i >= len(dates) or dates[i] != d:
                continue  # scan date missing from this ticker's bars
            after = tb.iloc[i + 1 : i + 1 + HORIZON]
            high_20 = _f(tb["h"].iloc[max(0, i - HIGH_WINDOW + 1) : i + 1].max())
            boxed = bool(r.boxed)
            level = breakout_level(float(r.close), boxed, _f(r.box_top), _f(r.pivot), high_20)
            adr_pct = _f(getattr(r, "adr_pct", None))
            adr = adr_pct / 100 if adr_pct and adr_pct > 0 else None
            pre_closes = tb["c"].iloc[max(0, i - KULLAMAGI_MA + 1) : i + 1].astype(float).tolist()
            lab = label_one(
                after, float(r.close), level, _f(r.box_top) if boxed else None, _f(r.box_bottom) if boxed else None, adr, pre_closes
            )
            entry_day = lab["k_entry_day"]
            if entry_day is not None and in_path_study(getattr(r, "rank", None), boxed, getattr(r, "verdict", None), float(r.close), _f(r.box_top)):
                start = i + entry_day  # after[0] is tb[i + 1], so entry day d (1-based in after) is tb[i + d]
                entry = float(tb["o"].iloc[start])
                path = follow_path(tb.iloc[start : start + PATH_DAYS], entry)
                lab["path_days"] = len(path)
                paths.extend([pyval(r.date), ticker, day, gain, low] for day, gain, low in path)
                if len(path) == PATH_DAYS:
                    stop = float(tb["l"].iloc[start - 1])  # the breakout day's low, as the plan sets it
                    if float(tb["l"].iloc[start]) <= stop:
                        lab["exit_grid"] = [-1.0] * EXIT_CELLS  # same-day stop-out, as the engine books it
                    else:
                        closes = tb["c"].iloc[max(0, start - EXIT_MA_MAX + 1) : start + 1].astype(float).tolist()
                        lab["exit_grid"] = exit_grid_r(tb.iloc[start + 1 : start + PATH_DAYS], entry, stop, closes)
            out.append([pyval(r.date), ticker] + [pyval(lab[k]) for k in COLUMNS[2:]])
    return out, paths


def _f(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(v) else v


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    rows = _pending_rows(conn, ctx.force)
    if rows.empty:
        return "nothing to label"
    rows["date"] = pd.to_datetime(rows["date"])
    tickers = rows["ticker"].unique().tolist()
    written = complete = path_rows = 0
    for i in range(0, len(tickers), CHUNK):
        chunk = tickers[i : i + CHUNK]
        sub = rows[rows["ticker"].isin(chunk)]
        since: date = sub["date"].min().date() - timedelta(days=35)  # room for the 20-session high
        bars = load_bars(conn, tickers=chunk, since=since.isoformat())
        labelled, paths = label_frame(sub, bars)
        written += write_rows(conn, "research_outcomes", COLUMNS, labelled, conflict=["date", "ticker"])
        path_rows += write_rows(conn, "research_paths", PATH_COLUMNS, paths, conflict=["date", "ticker", "day"])
        complete += sum(1 for r in labelled if r[COMPLETE_COL])
        conn.commit()
        if not ctx.has_time(15):
            return f"{written} rows labelled ({complete} complete), {path_rows} path days — out of time, resuming next run"
    return f"{written} rows labelled ({complete} complete), {path_rows} path days"
