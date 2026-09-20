"""Tests for research.breadth.compute_breadth — pure function, no database."""
import numpy as np
import pandas as pd
import pytest

from research.breadth import MIN_PRIOR_SESSIONS, compute_breadth


def _dates(n: int) -> pd.DatetimeIndex:
    return pd.date_range("2024-01-01", periods=n, freq="D")


def test_compute_breadth_hand_built_three_tickers():
    n = 70
    dates = _dates(n)
    idx = np.arange(n)

    close = pd.DataFrame(
        {
            "A": (100 + idx).astype(float),  # steadily rising -> ends at a fresh 63-session high
            "B": (200 - idx).astype(float),  # steadily falling -> ends at a fresh 63-session low
            "C": np.where(idx % 2 == 0, 150.0, 151.0),  # alternating, flat on average
        },
        index=dates,
    )
    volume = pd.DataFrame(
        {"A": 1_000_000.0, "B": 2_000_000.0, "C": 3_000_000.0},
        index=dates,
    )

    out = compute_breadth(close, volume, exclude=set(), min_universe=3)

    # first MIN_PRIOR_SESSIONS dates are skipped (no full 63-session window yet)
    assert len(out) == n - MIN_PRIOR_SESSIONS
    last = out.iloc[-1]

    assert last["universe"] == 3
    # A and C close above their 20-day average, B does not
    assert last["pct_above_20"] == pytest.approx(2 / 3)
    # A and C close above their 50-day average, B does not
    assert last["pct_above_50"] == pytest.approx(2 / 3)
    # only A has its 10-day average above its 20-day average (B: below both; C: tied, not strictly above)
    assert last["pct_10_over_20"] == pytest.approx(1 / 3)
    # A (rising) and C (alternating high) both sit at their 63-session max on the last day
    assert last["new_highs"] == 2
    # only B (falling) sits at its 63-session min on the last day
    assert last["new_lows"] == 1


def test_compute_breadth_excludes_index_etfs():
    n = 70
    dates = _dates(n)
    idx = np.arange(n)

    close = pd.DataFrame(
        {
            "A": (100 + idx).astype(float),
            "B": (100 + idx).astype(float),
            "QQQ": (100 + idx).astype(float),  # would otherwise qualify — must be excluded
        },
        index=dates,
    )
    volume = pd.DataFrame({"A": 1_000_000.0, "B": 1_000_000.0, "QQQ": 1_000_000.0}, index=dates)

    out = compute_breadth(close, volume, exclude={"QQQ", "SPY", "IWM"}, min_universe=2)

    assert not out.empty
    assert (out["universe"] == 2).all()


def test_compute_breadth_pct_above_50_is_none_without_enough_history():
    n = 70
    dates = _dates(n)
    start = 40  # every ticker's history begins on day 40 -> at most 30 sessions by the end

    close = pd.DataFrame(index=dates)
    volume = pd.DataFrame(index=dates)
    for i, ticker in enumerate(["A", "B", "C"]):
        c = pd.Series(np.nan, index=dates)
        c.iloc[start:] = 100.0 + i + np.arange(n - start)
        v = pd.Series(np.nan, index=dates)
        v.iloc[start:] = 5_000_000.0
        close[ticker] = c
        volume[ticker] = v

    out = compute_breadth(close, volume, exclude=set(), min_universe=3)

    assert not out.empty
    assert out["pct_above_50"].isna().all()


def test_compute_breadth_skips_thin_universe():
    n = 70
    dates = _dates(n)
    idx = np.arange(n)
    close = pd.DataFrame({"A": (100 + idx).astype(float)}, index=dates)
    volume = pd.DataFrame({"A": 1_000_000.0}, index=dates)

    # default min_universe (100) is far above the single ticker available
    out = compute_breadth(close, volume, exclude=set())
    assert out.empty
