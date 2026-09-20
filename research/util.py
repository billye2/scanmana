"""Shared job plumbing: the run context, the run log, and small pandas helpers.

Every job module exposes `run(conn, ctx) -> str` (a one-line note for the
research_runs table) and keeps its maths in pure functions over DataFrames so
tests/py can exercise them without a database.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
import psycopg

from .db import read_df


@dataclass
class JobContext:
    scan_date: str  # latest scan_results.date (YYYY-MM-DD)
    force: bool = False
    deadline: float = field(default_factory=lambda: time.monotonic() + 250)
    notes: dict[str, Any] = field(default_factory=dict)

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def has_time(self, seconds: float) -> bool:
        return self.remaining() >= seconds


def latest_scan_date(conn: psycopg.Connection) -> str | None:
    df = read_df(conn, "SELECT max(date)::text AS d FROM scan_results")
    v = df.iloc[0]["d"] if not df.empty else None
    return str(v) if v else None


def last_run(conn: psycopg.Connection, job: str) -> dict[str, Any] | None:
    df = read_df(conn, "SELECT job, scan_date::text AS scan_date, ok, finished_at FROM research_runs WHERE job = %s", [job])
    return None if df.empty else df.iloc[0].to_dict()


def is_current(conn: psycopg.Connection, job: str, scan_date: str) -> bool:
    r = last_run(conn, job)
    return bool(r and r["ok"] and r["scan_date"] == scan_date)


def mark_start(conn: psycopg.Connection, job: str, scan_date: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO research_runs (job, scan_date, started_at, finished_at, ok, note)
               VALUES (%s, %s, %s, NULL, NULL, NULL)
               ON CONFLICT (job) DO UPDATE SET scan_date = EXCLUDED.scan_date, started_at = EXCLUDED.started_at,
                 finished_at = NULL, ok = NULL, note = NULL""",
            [job, scan_date, datetime.now(timezone.utc)],
        )
    conn.commit()


def mark_done(conn: psycopg.Connection, job: str, ok: bool, note: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE research_runs SET finished_at = %s, ok = %s, note = %s WHERE job = %s",
            [datetime.now(timezone.utc), ok, note[:500], job],
        )
    conn.commit()


def as_date(s: str | date | pd.Timestamp) -> date:
    if isinstance(s, pd.Timestamp):
        return s.date()
    if isinstance(s, date):
        return s
    return date.fromisoformat(str(s)[:10])


def close_matrix(bars: pd.DataFrame, column: str = "c") -> pd.DataFrame:
    """bars (ticker, date, ...) → wide DataFrame indexed by date, one column per ticker."""
    if bars.empty:
        return pd.DataFrame()
    return bars.pivot(index="date", columns="ticker", values=column).sort_index()


def sma(wide: pd.DataFrame, n: int) -> pd.DataFrame:
    return wide.rolling(n, min_periods=n).mean()


def safe_div(a: float, b: float) -> float | None:
    if b is None or b == 0 or a is None or np.isnan(a) or np.isnan(b):
        return None
    return float(a / b)
