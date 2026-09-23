"""Theme clustering from price alone (research_clusters, research_cluster_members,
research_cluster_history).

Groups the liquid universe by 63-session return correlation (hierarchical,
average linkage, distance = 1 - corr). The equal-weight market return is
regressed out of every name first, so the clusters are themes rather than one
giant "everything moves with the tape" blob. Never touches
research_cluster_alias — that table holds user-authored names keyed by
cluster_key.
"""
from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd
import psycopg
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

from .db import load_bars, pyval, replace_table, write_rows
from .util import JobContext, as_date, close_matrix

EXCLUDE_TICKERS = {"QQQ", "SPY", "IWM"}  # lib/config.ts CONFIG.MARKET.STORED
MIN_PRICE = 5.0  # lib/screen.ts LOOSE_LIMITS.MIN_PRICE
MIN_DOLLAR_VOLUME = 5_000_000.0  # lib/screen.ts LOOSE_LIMITS.MIN_DOLLAR_VOLUME
MIN_HISTORY_SESSIONS = 64  # 64 closes -> 63 daily log returns
MAX_UNIVERSE = 1500  # cap on the most liquid names, to bound the matrix
RETURN_WINDOW = 64  # closes fed into the correlation calc (63 returns)
LOOKBACK_DAYS = 220  # calendar days of bars to load (comfortably > 64 sessions)

CLUSTER_COLUMNS = ["cluster_id", "cluster_key", "leaders", "members", "member_count", "ret_63d", "as_of"]
MEMBER_COLUMNS = ["ticker", "cluster_id"]
HISTORY_COLUMNS = ["as_of", "ticker", "cluster_key", "cluster_id"]


def history_rows(clusters: list[dict], scan_date) -> list[tuple]:
    """research_cluster_history rows for one night: (as_of, ticker, cluster_key, cluster_id). Pure.

    cluster_id follows the nightly numbering (1 = strongest), cluster_key is the
    stable-ish identity (the sorted leaders), so a theme can be followed across
    nights even when its rank moves.
    """
    rows = []
    for i, cl in enumerate(clusters, start=1):
        for m in cl["members"]:
            rows.append((pyval(scan_date), pyval(m), pyval(cl["cluster_key"]), pyval(i)))
    return rows


def residual_returns(log_ret: pd.DataFrame) -> pd.DataFrame:
    """Log returns with each column's beta to the equal-weight market removed. Pure."""
    mkt = log_ret.mean(axis=1)
    x = mkt - mkt.mean()
    denom = float((x**2).sum())
    if denom <= 0:
        return log_ret
    beta = log_ret.sub(log_ret.mean()).mul(x, axis=0).sum() / denom
    return log_ret - np.outer(mkt, beta)


def cluster_returns(closes_wide: pd.DataFrame, t: float = 0.55, min_members: int = 5, demarket: bool = True) -> list[dict]:
    """Cluster tickers (columns) by correlation of their trailing daily log returns.

    Takes the last `RETURN_WINDOW` rows of `closes_wide`, forward-fills gaps of
    at most 2 sessions, and drops any ticker still missing data. With
    `demarket` the equal-weight market return is regressed out first. Returns
    kept clusters (>= min_members) sorted by ret_63d descending; each dict has
    keys members, leaders, cluster_key, member_count, ret_63d.
    """
    window = closes_wide.tail(RETURN_WINDOW).copy()
    if window.shape[0] < 2:
        return []
    window = window.ffill(limit=2)
    valid_cols = [c for c in window.columns if window[c].notna().all()]
    window = window[valid_cols]
    if window.shape[1] < min_members:
        return []

    log_ret = np.log(window / window.shift(1)).iloc[1:]
    if log_ret.shape[0] < 2:
        return []
    basis = residual_returns(log_ret) if demarket and log_ret.shape[1] >= 5 else log_ret
    corr = basis.corr().astype(np.float32)

    dist = (1.0 - corr).clip(lower=0.0, upper=2.0)
    dist = (dist + dist.T) / 2.0  # guard against float asymmetry
    dist_values = dist.to_numpy(dtype=np.float64, copy=True)
    np.fill_diagonal(dist_values, 0.0)

    condensed = squareform(dist_values, checks=False)
    z = linkage(condensed, method="average")
    labels = fcluster(z, t=t, criterion="distance")

    total_ret = window.iloc[-1] / window.iloc[0] - 1.0  # simple return over the window

    groups: dict[int, list[str]] = {}
    for ticker, lab in zip(window.columns, labels):
        groups.setdefault(int(lab), []).append(ticker)

    out: list[dict] = []
    for members in groups.values():
        if len(members) < min_members:
            continue
        members_sorted = sorted(members, key=lambda tk: float(total_ret[tk]), reverse=True)
        leaders = members_sorted[:3]
        rets = [float(total_ret[m]) for m in members_sorted]
        out.append(
            {
                "members": members_sorted,
                "leaders": leaders,
                "cluster_key": "|".join(sorted(leaders)),
                "member_count": len(members_sorted),
                "ret_63d": float(np.median(rets)),
            }
        )

    out.sort(key=lambda d: d["ret_63d"], reverse=True)
    return out


def _write_empty(conn: psycopg.Connection) -> None:
    replace_table(conn, "research_clusters", CLUSTER_COLUMNS, [])
    replace_table(conn, "research_cluster_members", MEMBER_COLUMNS, [])


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    """Rebuild research_clusters / research_cluster_members as of ctx.scan_date."""
    scan_date = as_date(ctx.scan_date)
    since = (scan_date - timedelta(days=LOOKBACK_DAYS)).isoformat()
    bars = load_bars(conn, since=since)
    if not bars.empty:
        bars = bars[bars["date"] <= pd.Timestamp(scan_date)]
    if bars.empty:
        _write_empty(conn)
        return "0 clusters from 0 names"

    close = close_matrix(bars, "c")
    volume = close_matrix(bars, "v")
    cols = [c for c in close.columns if c not in EXCLUDE_TICKERS and c in volume.columns]
    close = close[cols]
    volume = volume[cols]
    if close.empty:
        _write_empty(conn)
        return "0 clusters from 0 names"

    asof = close.index.max()
    dollar_vol_20 = (close * volume).rolling(20, min_periods=20).mean()

    latest_close = close.loc[asof]
    latest_dv20 = dollar_vol_20.loc[asof]
    n_sessions = close.loc[:asof].notna().sum()

    mask = (
        latest_close.notna()
        & (latest_close >= MIN_PRICE)
        & latest_dv20.notna()
        & (latest_dv20 >= MIN_DOLLAR_VOLUME)
        & (n_sessions >= MIN_HISTORY_SESSIONS)
    )
    universe = latest_dv20[mask].sort_values(ascending=False).index[:MAX_UNIVERSE]
    universe_n = len(universe)
    if universe_n < 5:
        _write_empty(conn)
        return f"0 clusters from {universe_n} names"

    closes_wide = close[universe]
    clusters = cluster_returns(closes_wide, t=0.55, min_members=5)

    cluster_rows = []
    member_rows = []
    for i, cl in enumerate(clusters, start=1):
        cluster_rows.append(
            (
                pyval(i),
                pyval(cl["cluster_key"]),
                list(cl["leaders"]),
                list(cl["members"]),
                pyval(cl["member_count"]),
                pyval(cl["ret_63d"]),
                pyval(scan_date),
            )
        )
        for m in cl["members"]:
            member_rows.append((pyval(m), pyval(i)))

    replace_table(conn, "research_clusters", CLUSTER_COLUMNS, cluster_rows)
    replace_table(conn, "research_cluster_members", MEMBER_COLUMNS, member_rows)
    # The snapshot accumulates (upsert on as_of, ticker), so a forced rerun of the same night is a no-op.
    write_rows(conn, "research_cluster_history", HISTORY_COLUMNS, history_rows(clusters, scan_date), conflict=["as_of", "ticker"])

    return f"{len(clusters)} clusters from {universe_n} names"
