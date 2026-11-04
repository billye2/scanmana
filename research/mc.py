"""The drawdown fan (research_mc, 1.8.0, R5 of the Python-studies plan).

What the plan's own history produces by chance: the k_r of every boxed Wait
deck card the next-open plan entered (research/outcomes.py, the same rows the
plan card and the paths score) is drawn with replacement into N_SHUFFLES
sequences of trades, and the cumulative R after 1..T trades is read off at
five quantiles. The Auto book's actual closed trades (every user's, like
lib/research.ts closedTrades) give the book's own cumulative R, and book_pct
on the row for its trade count is the share of chance sequences that sit under
it — "the book's N trades sit at the Xth percentile". A fixed seed keeps the
bands still from night to night; only new history moves them. Understanding,
not a decision: the one card Billy chose knowingly outside the "changes a
take, a skip or a stop" rule.
"""
from __future__ import annotations

import numpy as np
import psycopg

from .db import pyval, read_df, replace_table
from .util import JobContext

N_SHUFFLES = 5000
MIN_TRADES = 60  # rows always cover at least this many trades
QUANTILES = (0.05, 0.25, 0.5, 0.75, 0.95)
SEED = 20261103
COLUMNS = ["trades", "q05", "q25", "q50", "q75", "q95", "book_pct", "as_of"]

PLAN_R_SQL = """
SELECT o.k_r FROM scan_history h JOIN research_outcomes o USING (date, ticker)
WHERE h.rank IS NOT NULL AND h.boxed AND h.verdict = 'wait' AND h.box_top IS NOT NULL AND h.close <= h.box_top
  AND o.k_r IS NOT NULL
"""
BOOK_SQL = """
SELECT p.entry_date, p.id, p.entry_price, p.initial_stop,
       sum(e.exit_price * e.shares)::double precision AS proceeds, sum(e.shares)::int AS sold
FROM paper_positions p JOIN paper_exits e ON e.position_id = p.id
WHERE p.track = 'auto' AND p.status = 'closed'
GROUP BY p.id, p.entry_date, p.entry_price, p.initial_stop
ORDER BY p.entry_date, p.id
"""


def simulate(rs: np.ndarray, trades: int, shuffles: int = N_SHUFFLES, seed: int = SEED) -> np.ndarray:
    """Cumulative R of `shuffles` sequences of `trades` draws with replacement from `rs`: shape (shuffles, trades). Pure."""
    rng = np.random.default_rng(seed)
    draws = rng.choice(np.asarray(rs, dtype=float), size=(shuffles, trades), replace=True)
    return np.cumsum(draws, axis=1)


def fan(sims: np.ndarray, quantiles: tuple[float, ...] = QUANTILES) -> np.ndarray:
    """The bands: one row per trade count 1..T, one column per quantile. Pure."""
    return np.quantile(sims, quantiles, axis=0).T


def percentile_of(sims: np.ndarray, trades: int, cum_r: float) -> float:
    """Share of sequences whose cumulative R after `trades` trades is under `cum_r` (0..1). Pure."""
    return float((sims[:, trades - 1] < cum_r).mean())


def book_r(rows) -> list[float]:
    """R per closed Auto trade in entry order, as lib/research.ts closedTrades computes it. Pure."""
    out = []
    for r in rows.itertuples(index=False):
        if r.sold > 0 and r.entry_price > r.initial_stop:
            out.append(float((r.proceeds / r.sold - r.entry_price) / (r.entry_price - r.initial_stop)))
    return out


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    rs = read_df(conn, PLAN_R_SQL)["k_r"].to_numpy(dtype=float)
    if rs.size < 30:
        replace_table(conn, "research_mc", COLUMNS, [])
        return f"{rs.size} plan rows, under 30 — no fan"
    book = book_r(read_df(conn, BOOK_SQL))
    n_book = len(book)
    trades = max(MIN_TRADES, n_book)
    sims = simulate(rs, trades)
    bands = fan(sims)
    pct = percentile_of(sims, n_book, float(np.sum(book))) if n_book else None
    rows = [
        [t + 1, *[pyval(float(x)) for x in bands[t]], pyval(pct) if n_book and t + 1 == n_book else None, ctx.scan_date]
        for t in range(trades)
    ]
    replace_table(conn, "research_mc", COLUMNS, rows)
    tail = f", the book's {n_book} trades at the {round(pct * 100)}th percentile" if pct is not None else ", no closed Auto trades yet"
    return f"{trades} trade counts from {rs.size} plan rows × {N_SHUFFLES} shuffles{tail}"
