"""Market breadth per session (research_breadth).

Universe each day = tickers with close >= $5 and a 20-session average
dollar volume >= $5M (lib/screen.ts LOOSE_LIMITS), excluding the index ETFs
that also live in the bars table (lib/market.ts CONFIG.MARKET.INDICES).

Two implementations of the same numbers: `compute_breadth` (pandas, pure,
the spec the tests exercise) and BREADTH_SQL (window functions inside
Postgres, what `run` executes). The nightly increment needs 73 sessions of
history for every ticker — 430,000 bars rows, ~17 MB of Neon egress a night
when they were pulled into pandas (the largest single read in the app as of
2026-10-27, mistakes.md). The SQL returns one row per date instead. The two
must agree; `tests/py/test_breadth.py` pins the window sizes, and the SQL was
checked against 30 stored pandas-computed dates on production when it shipped.
"""
from __future__ import annotations

from datetime import timedelta

import pandas as pd
import psycopg

from .db import pyval, read_df, write_rows
from .util import JobContext, as_date, sma

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
BOOTSTRAP_SKIP_DAYS = 95  # ~MIN_PRIOR_SESSIONS sessions in calendar days: the first dates of a bootstrap window have no 63-session history

BREADTH_COLUMNS = ["date", "universe", "pct_above_20", "pct_above_50", "pct_10_over_20", "new_highs", "new_lows"]

# compute_breadth in SQL: per ticker, rolling averages / extremes over its own
# rows (ROWS BETWEEN n-1 PRECEDING AND CURRENT ROW, counted so a short history
# reads as null exactly where pandas' min_periods did), then one row per date
# over the universe. `since` bounds the window, `emit_from` the dates returned.
BREADTH_SQL = """
WITH w AS (
  SELECT ticker, date, c,
    avg(c * v::double precision) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS dv20,
    count(*) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS n20,
    avg(c) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS s10,
    count(*) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS n10,
    avg(c) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS s20,
    avg(c) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS s50,
    count(*) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS n50,
    max(c) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 62 PRECEDING AND CURRENT ROW) AS mx63,
    min(c) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 62 PRECEDING AND CURRENT ROW) AS mn63,
    count(*) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 62 PRECEDING AND CURRENT ROW) AS n63
  FROM bars
  WHERE date >= %(since)s AND ticker <> ALL(%(exclude)s)
)
SELECT date, count(*)::int AS universe,
  avg((c > s20)::int) AS pct_above_20,
  avg((c > s50)::int) FILTER (WHERE n50 >= 50) AS pct_above_50,
  avg((s10 > s20)::int) FILTER (WHERE n10 >= 10) AS pct_10_over_20,
  count(*) FILTER (WHERE n63 >= 63 AND c >= mx63)::int AS new_highs,
  count(*) FILTER (WHERE n63 >= 63 AND c <= mn63)::int AS new_lows
FROM w
WHERE n20 >= 20 AND c >= %(min_price)s AND dv20 >= %(min_dv)s AND date >= %(emit_from)s
GROUP BY date
HAVING count(*) >= %(min_universe)s
ORDER BY date
"""


def breadth_sql(conn: psycopg.Connection, since: "date", emit_from: "date") -> pd.DataFrame:
    """compute_breadth evaluated inside Postgres: one row per date from `emit_from`
    on, with `since` giving the window its history. Columns = BREADTH_COLUMNS."""
    df = read_df(
        conn,
        BREADTH_SQL,
        {
            "since": since, "emit_from": emit_from, "exclude": sorted(EXCLUDE_TICKERS),
            "min_price": MIN_PRICE, "min_dv": MIN_DOLLAR_VOLUME, "min_universe": MIN_UNIVERSE,
        },
    )
    if df.empty:
        return pd.DataFrame(columns=BREADTH_COLUMNS)
    df["date"] = pd.to_datetime(df["date"])
    for col in ("pct_above_20", "pct_above_50", "pct_10_over_20"):
        df[col] = df[col].astype(float)
    df["pct_above_50"] = df["pct_above_50"].where(df["pct_above_50"].notna(), None)
    return df[BREADTH_COLUMNS]


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
    # Emit from the last stored date (so a rescan of it is picked up), or, on the
    # bootstrap, once the window holds MIN_PRIOR_SESSIONS sessions — the same
    # dates compute_breadth would have produced from the loaded frame.
    emit_from = last_stored if write_from is not None else since + timedelta(days=BOOTSTRAP_SKIP_DAYS)
    out = breadth_sql(conn, since, emit_from)
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
