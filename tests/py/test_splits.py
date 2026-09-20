"""Tests for research.splits.detect_splits — pure function, no database."""
import numpy as np
import pandas as pd
import pytest

from research.splits import detect_splits


def _ticker_bars(ticker: str, dates: pd.DatetimeIndex, closes: list[float], volumes: list[float]) -> pd.DataFrame:
    closes_arr = np.array(closes, dtype=float)
    volumes_arr = np.array(volumes, dtype=float)
    opens_arr = closes_arr.copy()  # no intraday move: the only jump is the overnight gap
    return pd.DataFrame(
        {
            "ticker": ticker,
            "date": dates,
            "o": opens_arr,
            "h": np.maximum(opens_arr, closes_arr),
            "l": np.minimum(opens_arr, closes_arr),
            "c": closes_arr,
            "v": volumes_arr,
        }
    )


def _bars() -> tuple[pd.DataFrame, pd.DatetimeIndex]:
    dates = pd.date_range("2024-01-01", periods=20, freq="D")

    # 1:3 reverse split on day 10: price jumps 10 -> 30, volume drops to a third
    rev = _ticker_bars(
        "REV",
        dates,
        closes=[10.0] * 10 + [30.0] * 10,
        volumes=[3_000_000.0] * 10 + [1_000_000.0] * 10,
    )

    # 4:1 forward split on day 10: price drops 40 -> 10, volume rises 4x
    fwd = _ticker_bars(
        "FWD",
        dates,
        closes=[40.0] * 10 + [10.0] * 10,
        volumes=[2_000_000.0] * 10 + [8_000_000.0] * 10,
    )

    # a plain 20% earnings gap on day 10 — not a split, volume unremarkable
    earn = _ticker_bars(
        "EARN",
        dates,
        closes=[50.0] * 10 + [60.0] * 10,
        volumes=[1_000_000.0] * 20,
    )

    bars = pd.concat([rev, fwd, earn], ignore_index=True)
    return bars, dates


def test_detects_reverse_split_as_auto():
    bars, dates = _bars()
    out = detect_splits(bars)

    rows = out[(out["ticker"] == "REV") & (out["date"] == dates[10])]
    assert len(rows) == 1
    row = rows.iloc[0]

    assert bool(row["clean"])
    assert row["factor"] == pytest.approx(3.0)
    assert row["ratio"] == pytest.approx(3.0)
    assert row["gap_pct"] == pytest.approx(2.0)
    assert row["vol_ratio"] == pytest.approx(1 / 3)
    assert row["confidence"] == pytest.approx(1.0)
    assert row["status"] == "auto"


def test_detects_forward_split_as_auto():
    bars, dates = _bars()
    out = detect_splits(bars)

    rows = out[(out["ticker"] == "FWD") & (out["date"] == dates[10])]
    assert len(rows) == 1
    row = rows.iloc[0]

    assert bool(row["clean"])
    assert row["factor"] == pytest.approx(0.25)
    assert row["ratio"] == pytest.approx(0.25)
    assert row["gap_pct"] == pytest.approx(-0.75)
    assert row["vol_ratio"] == pytest.approx(4.0)
    assert row["confidence"] == pytest.approx(1.0)
    assert row["status"] == "auto"


def test_does_not_flag_a_plain_earnings_gap():
    bars, _dates = _bars()
    out = detect_splits(bars)

    assert out[out["ticker"] == "EARN"].empty


def test_low_confidence_unclean_gap_is_dropped():
    # a one-off ~55% gap with no clean ratio match and no volume signature —
    # confidence stays near the 0.15 unclean floor and is dropped by the keep threshold.
    dates = pd.date_range("2024-01-01", periods=20, freq="D")
    closes = [10.0] * 10 + [15.5] * 1 + [10.2, 10.1, 10.0, 9.9, 9.8, 9.9, 10.0, 10.1, 10.0]
    volumes = [1_000_000.0] * 20
    bars = _ticker_bars("NOISY", dates, closes, volumes)

    out = detect_splits(bars)
    assert out[(out["ticker"] == "NOISY") & (out["date"] == dates[10])].empty


def test_earnings_crash_that_mimics_a_3_for_2_split_stays_in_review():
    """A -33% gap with a huge range and 8x volume looks like a 3:2 split by ratio alone.
    The news signature must keep it out of 'auto' (auto rows rescale the scan's bars)."""
    dates = pd.date_range("2024-01-01", periods=40, freq="D")
    n = len(dates)
    closes = np.array([30.0] * 20 + [20.0] * 20)
    opens = closes.copy()
    highs = closes * 1.01
    lows = closes * 0.99
    highs[20], lows[20] = 22.5, 18.5  # 20% range on the gap day vs ~2% normally
    vols = np.array([1_000_000.0] * 20 + [1_500_000.0] * 20)  # post-day median matches a 3:2 (1.5x)
    vols[20] = 12_000_000.0  # 8x the expected split-day volume
    bars = pd.DataFrame({"ticker": "CRASH", "date": dates, "o": opens, "h": highs, "l": lows, "c": closes, "v": vols})
    out = detect_splits(bars)
    rows = out[(out["ticker"] == "CRASH") & (out["date"] == dates[20])]
    assert len(rows) == 1
    assert bool(rows.iloc[0]["clean"])
    assert rows.iloc[0]["status"] == "review"
    assert rows.iloc[0]["confidence"] < 0.9


def test_quiet_3_for_2_split_is_auto():
    dates = pd.date_range("2024-01-01", periods=40, freq="D")
    closes = np.array([30.0] * 20 + [20.0] * 20)
    highs, lows = closes * 1.01, closes * 0.99
    vols = np.array([1_000_000.0] * 20 + [1_500_000.0] * 20)
    bars = pd.DataFrame({"ticker": "SPLIT", "date": dates, "o": closes, "h": highs, "l": lows, "c": closes, "v": vols})
    out = detect_splits(bars)
    row = out[(out["ticker"] == "SPLIT") & (out["date"] == dates[20])].iloc[0]
    assert row["status"] == "auto"
    assert row["factor"] == pytest.approx(2 / 3)
