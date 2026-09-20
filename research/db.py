"""Neon access for the research jobs.

Reads COIL_DATABASE_URL only (the bare DATABASE_URL on this Vercel project
belongs to an unrelated earlier app — lib/db.ts enforces the same rule).
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterable, Iterator, Sequence

import pandas as pd
import psycopg
from psycopg import sql as pgsql


def _url() -> str:
    url = os.environ.get("COIL_DATABASE_URL")
    if not url:
        raise RuntimeError("COIL_DATABASE_URL is not set (Scanmana's own Neon DB — not the legacy DATABASE_URL)")
    return url


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(_url(), autocommit=False)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def read_df(conn: psycopg.Connection, query: str, params: Sequence[Any] | None = None) -> pd.DataFrame:
    """Run a SELECT and return a DataFrame with the cursor's column names."""
    with conn.cursor() as cur:
        cur.execute(query, params)
        cols = [d.name for d in cur.description or []]
        rows = cur.fetchall()
    return pd.DataFrame.from_records(rows, columns=cols)


def write_rows(
    conn: psycopg.Connection,
    table: str,
    columns: Sequence[str],
    rows: Iterable[Sequence[Any]],
    conflict: Sequence[str] | None = None,
    batch: int = 500,
) -> int:
    """Batched INSERT ... ON CONFLICT DO UPDATE (all non-key columns). Returns the row count."""
    rows = list(rows)
    if not rows:
        return 0
    cols = pgsql.SQL(", ").join(pgsql.Identifier(c) for c in columns)
    placeholders = pgsql.SQL(", ").join(pgsql.Placeholder() for _ in columns)
    stmt = pgsql.SQL("INSERT INTO {} ({}) VALUES ({})").format(pgsql.Identifier(table), cols, placeholders)
    if conflict:
        updates = [c for c in columns if c not in conflict]
        if updates:
            set_clause = pgsql.SQL(", ").join(
                pgsql.SQL("{} = EXCLUDED.{}").format(pgsql.Identifier(c), pgsql.Identifier(c)) for c in updates
            )
            stmt += pgsql.SQL(" ON CONFLICT ({}) DO UPDATE SET {}").format(
                pgsql.SQL(", ").join(pgsql.Identifier(c) for c in conflict), set_clause
            )
        else:
            stmt += pgsql.SQL(" ON CONFLICT ({}) DO NOTHING").format(
                pgsql.SQL(", ").join(pgsql.Identifier(c) for c in conflict)
            )
    with conn.cursor() as cur:
        for i in range(0, len(rows), batch):
            cur.executemany(stmt, rows[i : i + batch])
    return len(rows)


def replace_table(conn: psycopg.Connection, table: str, columns: Sequence[str], rows: Iterable[Sequence[Any]]) -> int:
    """TRUNCATE-and-fill for tables that are a full nightly snapshot."""
    with conn.cursor() as cur:
        cur.execute(pgsql.SQL("DELETE FROM {}").format(pgsql.Identifier(table)))
    return write_rows(conn, table, columns, rows)


def load_bars(conn: psycopg.Connection, tickers: Sequence[str] | None = None, since: str | None = None) -> pd.DataFrame:
    """bars as a DataFrame (ticker, date, o, h, l, c, v) sorted by ticker, date."""
    clauses, params = [], []
    if tickers is not None:
        clauses.append("ticker = ANY(%s)")
        params.append(list(tickers))
    if since:
        clauses.append("date >= %s")
        params.append(since)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    df = read_df(
        conn,
        f"SELECT ticker, date, o, h, l, c, v::double precision AS v FROM bars {where} ORDER BY ticker, date",
        params,
    )
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df


def pyval(x: Any) -> Any:
    """numpy / pandas scalars → plain Python (psycopg cannot adapt numpy types)."""
    if x is None:
        return None
    if isinstance(x, float) and x != x:  # NaN
        return None
    if hasattr(x, "item"):
        try:
            v = x.item()
        except (ValueError, AttributeError):
            return x
        if isinstance(v, float) and v != v:
            return None
        return v
    if isinstance(x, pd.Timestamp):
        return x.date()
    return x
