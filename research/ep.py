"""Episodic-pivot study (research_ep): Kullamägi's main setup, measured on the
stored bars before anything about it reaches the deck.

An episodic pivot is a stock that gaps up on a news catalyst with a surge in
volume — ideally a *neglected* name that had gone sideways for months — bought
on the gap day and held for weeks with the stop at the low of that day. The
nightly screen cannot show one: it demands momentum and a close near the
6-month high, which the neglected names fail until the gap itself delivers
them. This job finds every gap day in the whole bars table that fits the
shape, records how neglected the name was before it, and labels the
end-of-day-tradeable version of the trade: buy at the next session's open,
stop at the gap day's low, then the Auto book's own exit routine
(research/replay.py `_replay_kullamagi`: half off at the day-4 open when day 3
closed above entry, breakeven, out at the open after a close under the
10-day average). /research reads the table split by neglect and by volume
multiple; the number decides whether an EP list is worth shipping.

Candidate = open at least MIN_GAP above the prior close, volume at least
MIN_VOL_MULT times the prior 20-session average, close at or above MIN_PRICE,
prior 20-session dollar volume at least MIN_DOLLAR_VOLUME (the deck's own
floors, lib/config.ts). The gap is capped at MAX_GAP: a reverse split looks
like a +400% gap on falling volume, and the Python jobs read raw bars (the
split factors are applied in lib/scan.ts, not in the table). The index ETFs
are excluded. All of that is decided inside Postgres with window functions so
only the candidate rows leave Neon (mistakes.md 2026-10-19); bars then load
for the candidate tickers only, 200 calendar days back for the 6-month
features, 20 sessions forward for the outcome.

Rows are re-labelled until the entry day plus HORIZON sessions exist
(complete = true), then left alone. Idempotent: (date, ticker) upserts.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
import psycopg

from .db import load_bars, pyval, read_df, write_rows
from .replay import replay_position
from .util import JobContext

MIN_GAP = 0.10  # lib/config.ts CONFIG.EP.MIN_GAP
MAX_GAP = 1.00  # a +100% overnight gap on real volume exists but a reverse split is the likelier reading
MIN_VOL_MULT = 3.0  # CONFIG.EP.VOL_MULT — the badge's floor; the multiple is stored so 5× / 10× can be cut on the page
VOL_WINDOW = 20  # CONFIG.EP.VOL_WINDOW
MIN_PRICE = 10.0  # CONFIG.MIN_PRICE
MIN_DOLLAR_VOLUME = 20_000_000.0  # CONFIG.MIN_DOLLAR_VOLUME
EXCLUDE_TICKERS = ("QQQ", "SPY", "IWM")  # CONFIG.MARKET.STORED
HORIZON = 20  # sessions after the entry day the outcome is measured over (research/outcomes.py HORIZON)
M3, M6 = 63, 126  # CONFIG.LOOKBACK.M3 / M6, sessions
HIGH_LOOKBACK = 126  # CONFIG.HIGH_LOOKBACK
SHARES = 100  # R is share-weighted across legs, so any even count gives the same R
CHUNK = 200  # tickers per bars query
WINDOW_DAYS = 35  # calendar days the SQL window reaches back so the first candidate date has 20 prior sessions
FEATURE_DAYS = 200  # calendar days of bars before the earliest candidate for the 6-month features

COLUMNS = [
    "date", "ticker", "gap_pct", "vol_mult", "day_pct", "held_gap",
    "ret_3m_before", "ret_6m_before", "dist_high_before",
    "taken", "entry", "stop", "r_at_exit", "hold", "mfe_20", "mae_20",
    "sessions_after", "complete",
]

CANDIDATE_SQL = """
WITH w AS (
  SELECT ticker, date, o, h, l, c, v::double precision AS v,
         lag(c) OVER (PARTITION BY ticker ORDER BY date) AS prev_c,
         avg(v::double precision) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN {n} PRECEDING AND 1 PRECEDING) AS vol20,
         avg(c * v::double precision) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN {n} PRECEDING AND 1 PRECEDING) AS dv20,
         count(*) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN {n} PRECEDING AND 1 PRECEDING) AS n20
  FROM bars
  WHERE ticker <> ALL(%(exclude)s) {since_clause}
)
SELECT ticker, date, o, h, l, c, v, prev_c, vol20, dv20
FROM w
WHERE n20 = {n} AND prev_c > 0 AND vol20 > 0
  AND o / prev_c - 1 >= %(min_gap)s AND o / prev_c - 1 <= %(max_gap)s
  AND v >= %(vol_mult)s * vol20
  AND c >= %(min_price)s AND dv20 >= %(min_dv)s
  {emit_clause}
ORDER BY ticker, date
"""


def find_candidates(conn: psycopg.Connection, since: date | None) -> pd.DataFrame:
    """Gap days that fit the EP shape, found inside Postgres. `since` = emit
    candidates from this date on (the window reaches WINDOW_DAYS further back
    for the prior-20-session averages); None = the whole table."""
    params: dict[str, Any] = {
        "exclude": list(EXCLUDE_TICKERS), "min_gap": MIN_GAP, "max_gap": MAX_GAP,
        "vol_mult": MIN_VOL_MULT, "min_price": MIN_PRICE, "min_dv": MIN_DOLLAR_VOLUME,
    }
    if since is None:
        sql = CANDIDATE_SQL.format(n=VOL_WINDOW, since_clause="", emit_clause="")
    else:
        params["window_from"] = since - timedelta(days=WINDOW_DAYS)
        params["since"] = since
        sql = CANDIDATE_SQL.format(n=VOL_WINDOW, since_clause="AND date >= %(window_from)s", emit_clause="AND date >= %(since)s")
    df = read_df(conn, sql, params)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df


def label_ep(tb: pd.DataFrame, i: int) -> dict[str, Any]:
    """Features and outcome for the gap day at row `i` of one ticker's bars
    (columns o, h, l, c, v, ascending by date). Pure.

    Features read the bars up to the day before the gap: 3- and 6-month
    returns, distance under the 6-month high (a positive fraction, as
    scan_history stores it). held_gap = closed above its open. The trade:
    entry at the next session's open, stop at the gap day's low; not taken
    when that open is at or under the stop (the Auto book cancels a market
    order in that spot). An entry day whose low reaches the stop is a
    same-day −1R, as in lib/paper-engine.ts. Otherwise the sessions after the
    entry day replay under the kullamagi rule; r_at_exit stays null until a
    rule exited or HORIZON sessions exist (then marked to the last close).
    mfe_20 / mae_20 are the best and worst closes over those HORIZON
    sessions against the entry, null until they exist.
    """
    o = tb["o"].to_numpy(dtype=float)
    h = tb["h"].to_numpy(dtype=float)
    lo = tb["l"].to_numpy(dtype=float)
    c = tb["c"].to_numpy(dtype=float)
    v = tb["v"].to_numpy(dtype=float)
    n = len(tb)
    prev_c = c[i - 1]
    vol20 = float(v[i - VOL_WINDOW : i].mean()) if i >= VOL_WINDOW else float("nan")
    out: dict[str, Any] = {
        "gap_pct": float(o[i] / prev_c - 1),
        "vol_mult": float(v[i] / vol20) if vol20 > 0 else None,
        "day_pct": float(c[i] / prev_c - 1),
        "held_gap": bool(c[i] > o[i]),
        "ret_3m_before": float(prev_c / c[i - 1 - M3] - 1) if i - 1 - M3 >= 0 and c[i - 1 - M3] > 0 else None,
        "ret_6m_before": float(prev_c / c[i - 1 - M6] - 1) if i - 1 - M6 >= 0 and c[i - 1 - M6] > 0 else None,
        "dist_high_before": None,
        "taken": None, "entry": None, "stop": None, "r_at_exit": None, "hold": None,
        "mfe_20": None, "mae_20": None,
        "sessions_after": int(n - 1 - i), "complete": bool(n - 1 - i >= HORIZON + 1),
    }
    lookback = h[max(0, i - HIGH_LOOKBACK) : i]
    if lookback.size:
        hi = float(lookback.max())
        if hi > 0:
            out["dist_high_before"] = float(1 - prev_c / hi)
    if i + 1 >= n:
        return out  # the gap was the last session stored: no entry open yet

    entry = float(o[i + 1])
    stop = float(lo[i])
    out["entry"], out["stop"] = entry, stop
    risk = entry - stop
    if risk <= 0:
        out["taken"] = False
        return out
    out["taken"] = True
    after = tb.iloc[i + 2 : i + 2 + HORIZON]
    if lo[i + 1] <= stop:
        out["r_at_exit"], out["hold"] = -1.0, 1
    elif not after.empty:
        res = replay_position(
            after[["date", "o", "h", "l", "c"]], entry, stop, SHARES, "kullamagi",
            pre_closes=c[max(0, i + 2 - 10) : i + 2].tolist(),
        )
        if not res["mtm"] or len(after) >= HORIZON:
            out["r_at_exit"] = float(res["r"])
            out["hold"] = int(res["hold"]) + 1  # replay counts from the session after entry
    if len(after) >= HORIZON:
        closes = after["c"].to_numpy(dtype=float)
        out["mfe_20"] = float(closes.max() / entry - 1)
        out["mae_20"] = float(closes.min() / entry - 1)
    return out


def label_frame(cands: pd.DataFrame, bars: pd.DataFrame) -> list[list[Any]]:
    """Label every candidate row against `bars` (ticker, date, o, h, l, c, v). Pure."""
    out: list[list[Any]] = []
    if cands.empty or bars.empty:
        return out
    bars = bars.sort_values(["ticker", "date"])
    for ticker, grp in cands.groupby("ticker", sort=False):
        tb = bars[bars["ticker"] == ticker].reset_index(drop=True)
        if tb.empty:
            continue
        dates = tb["date"].to_numpy(dtype="datetime64[ns]")
        for r in grp.itertuples(index=False):
            d = np.datetime64(pd.Timestamp(r.date), "ns")
            i = int(np.searchsorted(dates, d))
            if i >= len(dates) or dates[i] != d or i < 1:
                continue
            lab = label_ep(tb, i)
            out.append([pyval(r.date), ticker] + [pyval(lab[k]) for k in COLUMNS[2:]])
    return out


def _since(conn: psycopg.Connection, force: bool) -> date | None:
    """Earliest date whose rows still need labelling: the oldest incomplete row,
    else the day after the newest row. None = bootstrap the whole table."""
    if force:
        return None
    df = read_df(conn, "SELECT min(date) FILTER (WHERE NOT complete)::text AS pending, max(date)::text AS newest FROM research_ep")
    if df.empty or not df.iloc[0]["newest"]:
        return None
    pending = df.iloc[0]["pending"]
    if pending:
        return date.fromisoformat(pending)
    return date.fromisoformat(df.iloc[0]["newest"]) + timedelta(days=1)


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    since = _since(conn, ctx.force)
    cands = find_candidates(conn, since)
    if cands.empty:
        return "no new episodic pivots" if since else "no episodic pivots in the stored bars"
    tickers = cands["ticker"].unique().tolist()
    written = complete = 0
    for k in range(0, len(tickers), CHUNK):
        chunk = tickers[k : k + CHUNK]
        sub = cands[cands["ticker"].isin(chunk)]
        start = (sub["date"].min() - pd.Timedelta(days=FEATURE_DAYS)).date().isoformat()
        bars = load_bars(conn, tickers=chunk, since=start)
        labelled = label_frame(sub, bars)
        written += write_rows(conn, "research_ep", COLUMNS, labelled, conflict=["date", "ticker"])
        complete += sum(1 for r in labelled if r[-1])
        conn.commit()
        if not ctx.has_time(15):
            return f"{written} episodic pivots labelled ({complete} complete) — out of time, resuming next run"
    return f"{written} episodic pivots labelled ({complete} complete)"
