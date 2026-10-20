"""Market breadth per session (research_breadth).

Universe each day = tickers with close >= $5 and a 20-session average
dollar volume >= $5M (lib/screen.ts LOOSE_LIMITS), excluding the index ETFs
that also live in the bars table (lib/market.ts CONFIG.MARKET.INDICES).
"""
from __future__ import annotations

from datetime import timedelta

import pandas as pd
import psycopg

from .db import load_bars, pyval, read_df, write_rows
from .util import JobContext, as_date, close_matrix, sma

EXCLUDE_TICKERS = {"QQQ", "SPY", "IWM"}  # lib/config.ts CONFIG.MARKET.STORED
MIN_PRICE = 5.0  # lib/screen.ts LOOSE_LIMITS.MIN_PRICE
MIN_DOLLAR_VOLUME = 5_000_000.0  # lib/screen.ts LOOSE_LIMITS.MIN_DOLLAR_VOLUME
MIN_UNIVERSE = 100  # skip thin days (holidays, partial data) entirely
MIN_PRIOR_SESSIONS = 63  # need a full 63-session window for new_highs/new_lows
LOOKBACK_DAYS = 470  # calendar days of bars to load when research_breadth is empty (bootstrap)
# Nightly: research_breadth already holds every earlier date, so only the dates
# since the last stored one are recomputed, from a window that still gives the
# first of them MIN_PRIOR_SESSIONS of history (110 calendar days >= 73 sessions).
INCREMENT_LOOKBACK_DAYS = 110
WRITE_WINDOW_DAYS = 400  # calendar days of output to keep (matches CONFIG.PRUNE_DAYS)

BREADTH_COLUMNS = ["date", "universe", "pct_above_20", "pct_above_50", "pct_10_over_20", "new_highs", "new_lows"]


def compute_breadth(
    close: pd.DataFrame,
    volume: pd.DataFrame,
    exclude: set[str],
    min_universe: int = MIN_UNIVERSE,
) -> pd.DataFrame:
    """Per-date breadth stats from wide close/volume matrices (index = date).

    `min_universe` defaults to the production floor (100 names) but is
    overridable so tests can exercise the math on a handful of tickers.
    """
    cols = [c for c in close.columns if c not in exclude and c in volume.columns]
    close = close[cols]
    volume = volume[cols]
    if close.empty:
        return pd.DataFrame(columns=BREADTH_COLUMNS)

    dollar_vol = close * volume
    dv20 = dollar_vol.rolling(20, min_periods=20).mean()
    sma10 = sma(close, 10)
    sma20 = sma(close, 20)
    sma50 = sma(close, 50)
    max63 = close.rolling(63, min_periods=63).max()
    min63 = close.rolling(63, min_periods=63).min()

    records: list[dict] = []
    dates = close.index
    for i, d in enumerate(dates):
        if i < MIN_PRIOR_SESSIONS:
            continue
        c_row = close.loc[d]
        dv20_row = dv20.loc[d]
        in_univ = c_row.notna() & dv20_row.notna() & (c_row >= MIN_PRICE) & (dv20_row >= MIN_DOLLAR_VOLUME)
        univ_cols = in_univ[in_univ].index
        n_univ = len(univ_cols)
        if n_univ < min_universe:
            continue

        c_u = c_row[univ_cols]
        s10 = sma10.loc[d, univ_cols]
        s20 = sma20.loc[d, univ_cols]
        s50 = sma50.loc[d, univ_cols]
        mx = max63.loc[d, univ_cols]
        mn = min63.loc[d, univ_cols]

        v20 = s20.notna()
        pct_above_20 = float((c_u[v20] > s20[v20]).mean()) if v20.any() else 0.0

        v50 = s50.notna()
        pct_above_50 = float((c_u[v50] > s50[v50]).mean()) if v50.any() else None

        v1020 = s10.notna() & s20.notna()
        pct_10_over_20 = float((s10[v1020] > s20[v1020]).mean()) if v1020.any() else 0.0

        vmx = mx.notna()
        new_highs = int((c_u[vmx] == mx[vmx]).sum())
        vmn = mn.notna()
        new_lows = int((c_u[vmn] == mn[vmn]).sum())

        records.append(
            {
                "date": d,
                "universe": n_univ,
                "pct_above_20": pct_above_20,
                "pct_above_50": pct_above_50,
                "pct_10_over_20": pct_10_over_20,
                "new_highs": new_highs,
                "new_lows": new_lows,
            }
        )

    return pd.DataFrame(records, columns=BREADTH_COLUMNS)


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    """Compute breadth for the dates not yet stored (plus the last stored one, so a
    rescan of that date is picked up) and upsert them. Loads closes and volume only."""
    scan_date = as_date(ctx.scan_date)
    stored = read_df(conn, "SELECT max(date) AS d FROM research_breadth")
    last_stored = stored["d"].iloc[0] if not stored.empty else None
    if last_stored is None or pd.isna(last_stored):
        since = scan_date - timedelta(days=LOOKBACK_DAYS)
        write_from = None
    else:
        last_stored = as_date(last_stored)
        since = last_stored - timedelta(days=INCREMENT_LOOKBACK_DAYS)
        write_from = pd.Timestamp(last_stored)
    bars = load_bars(conn, since=since.isoformat(), columns=("c", "v"))
    if bars.empty:
        return "0 dates written"

    close = close_matrix(bars, "c")
    volume = close_matrix(bars, "v")
    out = compute_breadth(close, volume, EXCLUDE_TICKERS)
    if out.empty:
        return "0 dates written"

    cutoff = pd.Timestamp(scan_date - timedelta(days=WRITE_WINDOW_DAYS))
    if write_from is not None:
        cutoff = max(cutoff, write_from)
    out = out[out["date"] >= cutoff]
    if out.empty:
        return "0 dates written"

    rows = [
        (
            pyval(as_date(r.date)),
            pyval(r.universe),
            pyval(r.pct_above_20),
            pyval(r.pct_above_50),
            pyval(r.pct_10_over_20),
            pyval(r.new_highs),
            pyval(r.new_lows),
        )
        for r in out.itertuples()
    ]
    n = write_rows(conn, "research_breadth", BREADTH_COLUMNS, rows, conflict=["date"])
    latest = as_date(out["date"].max()).isoformat()
    return f"{n} dates written, latest {latest}"
