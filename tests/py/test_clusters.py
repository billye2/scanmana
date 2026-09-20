"""Tests for research.clusters.cluster_returns — pure function, no database."""
import numpy as np
import pandas as pd

from datetime import date

from research.clusters import cluster_returns, history_rows, residual_returns


def _prices_from_log_returns(log_returns: np.ndarray, start: float = 100.0) -> np.ndarray:
    log_prices = np.concatenate([[np.log(start)], np.log(start) + np.cumsum(log_returns)])
    return np.exp(log_prices)


def _make_group(rng: np.random.Generator, base: np.ndarray, n_members: int, prefix: str, noise_scale: float = 0.001) -> dict:
    cols = {}
    for i in range(n_members):
        noise = rng.normal(0.0, noise_scale, size=base.shape[0])
        cols[f"{prefix}{i}"] = _prices_from_log_returns(base + noise)
    return cols


def test_cluster_returns_separates_groups_and_drops_small_group():
    rng = np.random.default_rng(42)
    n_days = 63  # 63 daily returns -> 64 closes

    base_a = rng.normal(0.0010, 0.01, n_days)
    base_b = rng.normal(-0.0005, 0.01, n_days)
    base_small = rng.normal(0.0020, 0.01, n_days)

    data = {}
    data.update(_make_group(rng, base_a, 8, "A"))
    data.update(_make_group(rng, base_b, 8, "B"))
    data.update(_make_group(rng, base_small, 3, "S"))  # below min_members, must be dropped

    closes = pd.DataFrame(data)
    clusters = cluster_returns(closes, t=0.55, min_members=5)

    all_members = {m for c in clusters for m in c["members"]}
    assert not any(m.startswith("S") for m in all_members), "the 3-member group must be dropped"

    assert len(clusters) == 2
    seen_prefixes = set()
    for c in clusters:
        prefixes = {m[0] for m in c["members"]}
        assert len(prefixes) == 1, f"cluster mixed tickers from two groups: {c['members']}"
        seen_prefixes |= prefixes
        assert c["member_count"] == 8
        assert len(c["leaders"]) == 3
        assert c["cluster_key"] == "|".join(sorted(c["leaders"]))
        # members within a cluster are sorted by 63-session return, descending
        rets = [closes[m].iloc[-1] / closes[m].iloc[0] - 1.0 for m in c["members"]]
        assert rets == sorted(rets, reverse=True)
    assert seen_prefixes == {"A", "B"}

    # clusters are ordered by ret_63d descending
    assert clusters[0]["ret_63d"] >= clusters[1]["ret_63d"]


def test_cluster_returns_drops_tickers_with_unrecoverable_gaps():
    rng = np.random.default_rng(7)
    n_days = 63
    base = rng.normal(0.001, 0.01, n_days)

    data = _make_group(rng, base, 6, "G")
    closes = pd.DataFrame(data)

    # a 7th ticker with a 3-session gap (more than the 2-session ffill allowance)
    bad = _prices_from_log_returns(base + rng.normal(0.0, 0.001, n_days))
    bad_series = pd.Series(bad)
    bad_series.iloc[10:13] = np.nan
    closes["BAD"] = bad_series.values

    clusters = cluster_returns(closes, t=0.55, min_members=5)

    all_members = {m for c in clusters for m in c["members"]}
    assert "BAD" not in all_members


def test_cluster_returns_below_min_members_returns_nothing():
    rng = np.random.default_rng(1)
    n_days = 63
    base = rng.normal(0.0, 0.01, n_days)
    data = _make_group(rng, base, 3, "X")
    closes = pd.DataFrame(data)

    clusters = cluster_returns(closes, t=0.55, min_members=5)
    assert clusters == []


def test_market_factor_is_removed_before_clustering():
    """Two themes riding one strong market factor: raw correlation lumps them together,
    de-marketed correlation keeps them apart."""
    rng = np.random.default_rng(3)
    n_days = 63
    market = rng.normal(0.0, 0.02, n_days)
    theme_a = rng.normal(0.0, 0.006, n_days)
    theme_b = rng.normal(0.0, 0.006, n_days)
    data = {}
    data.update(_make_group(rng, market + theme_a, 8, "A", noise_scale=0.002))
    data.update(_make_group(rng, market + theme_b, 8, "B", noise_scale=0.002))
    closes = pd.DataFrame(data)

    raw = cluster_returns(closes, t=0.55, min_members=5, demarket=False)
    assert len(raw) == 1 and raw[0]["member_count"] == 16

    themed = cluster_returns(closes, t=0.55, min_members=5)
    assert len(themed) == 2
    for c in themed:
        assert len({m[0] for m in c["members"]}) == 1

    log_ret = np.log(closes / closes.shift(1)).iloc[1:]
    resid = residual_returns(log_ret)
    assert abs(resid.mean(axis=1).abs().mean()) < 1e-3  # market component gone


def test_history_rows_one_per_member_with_nightly_id_and_stable_key():
    clusters = [
        {"cluster_key": "A|B", "members": ["A", "B", "C"], "leaders": ["A", "B"], "member_count": 3, "ret_63d": 0.2},
        {"cluster_key": "X|Y", "members": ["X", "Y"], "leaders": ["X", "Y"], "member_count": 2, "ret_63d": 0.1},
    ]
    rows = history_rows(clusters, date(2026, 9, 21))
    assert rows == [
        (date(2026, 9, 21), "A", "A|B", 1),
        (date(2026, 9, 21), "B", "A|B", 1),
        (date(2026, 9, 21), "C", "A|B", 1),
        (date(2026, 9, 21), "X", "X|Y", 2),
        (date(2026, 9, 21), "Y", "X|Y", 2),
    ]
    assert history_rows([], date(2026, 9, 21)) == []
