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
"""
from __future__ import annotations

from typing import Any

import pandas as pd
import psycopg

from .db import pyval, read_df, replace_table
from .util import JobContext

GRIDS: dict[str, list[float]] = {
    "MIN_DOLLAR_VOLUME": [5e6, 10e6, 15e6, 20e6, 25e6, 30e6, 35e6, 40e6, 45e6, 50e6],
    "MIN_ADR_PCT": [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0],
    "MAX_DIST_FROM_HIGH": [0.05, 0.10, 0.15, 0.20, 0.25, 0.30],
    "MIN_PRICE": [5, 10, 15, 20, 30],
}
CURRENT: dict[str, float] = {"MIN_DOLLAR_VOLUME": 20e6, "MIN_ADR_PCT": 3.5, "MAX_DIST_FROM_HIGH": 0.15, "MIN_PRICE": 10}
MAX_RESULTS = 60  # CONFIG.MAX_RESULTS

COLUMNS = ["param", "value", "deck_size", "hit_rate", "avg_r", "n", "is_current", "as_of"]
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
    replace_table(
        conn,
        "research_sweep",
        COLUMNS,
        [[r["param"], r["value"], r["deck_size"], pyval(r["hit_rate"]), pyval(r["avg_r"]), r["n"], r["is_current"], ctx.scan_date] for r in rows],
    )
    return f"{len(rows)} grid points over {df['date'].nunique()} sessions"
