"""Threshold sensitivity sweep.

scan_history holds every ticker that passed the LOOSE screen with the four
floor metrics recorded, so each sweep value is a filter, not a re-scan: hold
the other three floors at today's CONFIG, move one, re-apply the deck cap
(boxed first, tightest first, 60 per night) and read deck size and the 10-
session breakout rate from research_outcomes.

Approximation: MIN_PRICE also gates "every close of the last 21 sessions", which
scan_history cannot replay; only the scan-night close is filtered here.

GRIDS' loosest values must equal lib/screen.ts LOOSE_LIMITS; CURRENT mirrors
lib/config.ts. Both are asserted in tests/py/test_sweep.py.

Exit sweep (1.7.9, R4 of the Python-studies plan): the Auto book's exit
routine moved over research/replay.py EXIT_GRID (partial day 3/4/5 × exit MA
10/20 × breakeven on/off) on every boxed Wait deck card the plan entered, read
from research_outcomes.exit_grid (one R per cell, written by the outcomes job
on the twenty sessions from the entry — no bars are loaded here). Rows under
param EXIT_GRID (value = the cell's 1-based index in EXIT_GRID) plus the three
marginals EXIT_PARTIAL_DAY, EXIT_MA, EXIT_BREAKEVEN (value 1/0); hit_rate is
the win rate, deck_size the row count, sd_r the spread for the bands.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
import psycopg

from .db import pyval, read_df, replace_table
from .replay import EXIT_CURRENT, EXIT_GRID
from .util import JobContext

GRIDS: dict[str, list[float]] = {
    "MIN_DOLLAR_VOLUME": [5e6, 10e6, 15e6, 20e6, 25e6, 30e6, 35e6, 40e6, 45e6, 50e6],
    "MIN_ADR_PCT": [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0],
    "MAX_DIST_FROM_HIGH": [0.05, 0.10, 0.15, 0.20, 0.25, 0.30],
    "MIN_PRICE": [5, 10, 15, 20, 30],
}
CURRENT: dict[str, float] = {"MIN_DOLLAR_VOLUME": 20e6, "MIN_ADR_PCT": 3.5, "MAX_DIST_FROM_HIGH": 0.05, "MIN_PRICE": 10}
MAX_RESULTS = 60  # CONFIG.MAX_RESULTS

COLUMNS = ["param", "value", "deck_size", "hit_rate", "avg_r", "n", "is_current", "as_of", "sd_r"]

EXIT_SQL = """
WITH g AS (
  SELECT u.ord::int AS ord, u.r
  FROM scan_history h
  JOIN research_outcomes o USING (date, ticker),
  LATERAL unnest(o.exit_grid) WITH ORDINALITY AS u(r, ord)
  WHERE h.rank IS NOT NULL AND h.boxed AND h.verdict = 'wait' AND h.box_top IS NOT NULL AND h.close <= h.box_top
    AND o.exit_grid IS NOT NULL
),
k AS (SELECT ord, r, (%(pd)s::int[])[ord] AS pd, (%(ma)s::int[])[ord] AS ma, (%(be)s::int[])[ord] AS be FROM g)
SELECT 'EXIT_GRID' AS param, ord::float AS value, count(*)::int AS n, avg(r) AS avg_r, stddev_samp(r) AS sd_r, avg((r > 0)::int) AS win FROM k GROUP BY ord
UNION ALL SELECT 'EXIT_PARTIAL_DAY', pd::float, count(*)::int, avg(r), stddev_samp(r), avg((r > 0)::int) FROM k GROUP BY pd
UNION ALL SELECT 'EXIT_MA', ma::float, count(*)::int, avg(r), stddev_samp(r), avg((r > 0)::int) FROM k GROUP BY ma
UNION ALL SELECT 'EXIT_BREAKEVEN', be::float, count(*)::int, avg(r), stddev_samp(r), avg((r > 0)::int) FROM k GROUP BY be
ORDER BY 1, 2
"""


def exit_current(param: str, value: float) -> bool:
    """Whether a sweep row under one of the EXIT_* params is today's routine. Pure."""
    pd_now, ma_now, be_now = EXIT_GRID[EXIT_CURRENT]
    now = {"EXIT_GRID": EXIT_CURRENT + 1, "EXIT_PARTIAL_DAY": pd_now, "EXIT_MA": ma_now, "EXIT_BREAKEVEN": int(be_now)}
    return abs(value - now[param]) < 1e-9


def exit_sweep(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """The exit grid's rows from research_outcomes.exit_grid; empty before the outcomes job has written any."""
    df = read_df(
        conn,
        EXIT_SQL,
        {"pd": [pd for pd, _, _ in EXIT_GRID], "ma": [ma for _, ma, _ in EXIT_GRID], "be": [int(be) for _, _, be in EXIT_GRID]},
    )
    return [
        {
            "param": r.param, "value": float(r.value), "deck_size": float(r.n), "hit_rate": pyval(r.win), "avg_r": pyval(r.avg_r),
            "sd_r": pyval(r.sd_r), "n": int(r.n), "is_current": exit_current(r.param, float(r.value)),
        }
        for r in df.itertuples(index=False)
    ]
_COL = {"MIN_DOLLAR_VOLUME": "dollar_vol", "MIN_ADR_PCT": "adr_pct", "MAX_DIST_FROM_HIGH": "dist_from_high", "MIN_PRICE": "close"}


def _mask(df: pd.DataFrame, limits: dict[str, float]) -> pd.Series:
    return (
        (df["dollar_vol"] >= limits["MIN_DOLLAR_VOLUME"])
        & (df["adr_pct"] >= limits["MIN_ADR_PCT"])
        & (df["dist_from_high"] <= limits["MAX_DIST_FROM_HIGH"])
        & (df["close"] >= limits["MIN_PRICE"])
    )


def cap_deck(df: pd.DataFrame, max_results: int = MAX_RESULTS) -> pd.DataFrame:
    """The deck cap of lib/screen.ts rankCandidates, per date: boxed first, tightest first."""
    if df.empty:
        return df
    ordered = df.sort_values(["date", "boxed", "tightness"], ascending=[True, False, True])
    return ordered.groupby("date", sort=False).head(max_results)


def sweep(df: pd.DataFrame, grids: dict[str, list[float]] = GRIDS, current: dict[str, float] = CURRENT) -> list[dict[str, Any]]:
    """One row per (param, value). df = scan_history joined with research_outcomes (broke_10d, r_at_exit). Pure."""
    out: list[dict[str, Any]] = []
    if df.empty:
        return out
    n_dates = df["date"].nunique()
    for param, values in grids.items():
        for v in values:
            limits = dict(current)
            limits[param] = v
            deck = cap_deck(df[_mask(df, limits)])
            known = deck["broke_10d"].dropna()
            rs = deck["r_at_exit"].dropna()
            out.append(
                {
                    "param": param,
                    "value": float(v),
                    "deck_size": float(len(deck) / n_dates) if n_dates else 0.0,
                    "hit_rate": float(known.astype(float).mean()) if len(known) else None,
                    "avg_r": float(rs.mean()) if len(rs) else None,
                    "n": int(len(known)),
                    "is_current": bool(abs(float(v) - current[param]) < 1e-9),
                }
            )
    return out


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    df = read_df(
        conn,
        """SELECT h.date, h.ticker, h.close, h.dollar_vol, h.adr_pct, h.dist_from_high, h.tightness, h.boxed,
                  o.broke_10d, o.r_at_exit
           FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker)""",
    )
    if df.empty:
        return "no scan history yet"
    rows = sweep(df)
    exits = exit_sweep(conn)
    replace_table(
        conn,
        "research_sweep",
        COLUMNS,
        [
            [r["param"], r["value"], r["deck_size"], pyval(r["hit_rate"]), pyval(r["avg_r"]), r["n"], r["is_current"], ctx.scan_date, pyval(r.get("sd_r"))]
            for r in rows + exits
        ],
    )
    return f"{len(rows)} grid points over {df['date'].nunique()} sessions, {len(exits)} exit cells"
