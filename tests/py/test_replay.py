"""Hand-built-bar tests for research/replay.py — no database needed.

Bars are plain pandas DataFrames with columns date, o, h, l, c representing
sessions strictly after a position's entry_date, per replay_position's
contract.
"""
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from research.replay import replay_position, summarize


def _bars(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def _d(n: int) -> date:
    """The n-th session after entry (1-indexed), just to keep dates distinct and ordered."""
    return date(2026, 1, n)


# ---------- (a) trail_10 exits at min(open, stop) on the session the low breaches ----------


def test_trail10_exit_no_gap_fills_at_stop():
    # Day 1 survives and ratchets the stop to 95 (the day-1 low, since the
    # window is smaller than 10 sessions this early). Day 2's low (93) breaches
    # that 95 stop; the open (97) sits above the stop, so the fill is the stop.
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 95, "c": 100},
            {"date": _d(2), "o": 97, "h": 99, "l": 93, "c": 94},
        ]
    )
    result = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="trail_10")
    assert result["exit_price"] == pytest.approx(95.0)
    assert result["exit_date"] == _d(2)
    assert result["hold"] == 2
    assert result["mtm"] is False
    assert result["r"] == pytest.approx((95 - 100) / (100 - 90))
    assert result["pnl"] == pytest.approx((95 - 100) * 10)


def test_trail10_exit_gap_below_stop_fills_at_open():
    # Same day-1 setup (stop ratchets to 95); day 2 gaps open below that stop,
    # so the fill is the open, not the stop.
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 95, "c": 100},
            {"date": _d(2), "o": 90, "h": 91, "l": 80, "c": 85},
        ]
    )
    result = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="trail_10")
    assert result["exit_price"] == pytest.approx(90.0)
    assert result["hold"] == 2
    assert result["mtm"] is False


# ---------- (b) pct_8 ratchets the stop up after new closing highs, never down ----------


def test_pct8_never_lowers_the_stop_below_where_it_started():
    # initial_stop (97) sits tighter than entry_price * 0.92 (92): a correct
    # ratchet-up-only implementation must hold the stop at 97 (not slide it
    # down to 92) until a new closing high pushes 8%-below-peak past it.
    # Day 1's low (98) survives 97 but would also survive a buggy 92 stop, so
    # this alone doesn't distinguish; day 2's low (95) breaches the correct
    # 97 stop while a buggy 92 stop would wrongly let it ride.
    bars = _bars(
        [
            {"date": _d(1), "o": 99, "h": 101, "l": 98, "c": 99},  # close 99 < entry 100: peak_close stays 100
            {"date": _d(2), "o": 96, "h": 99, "l": 95, "c": 97},
        ]
    )
    result = replay_position(bars, entry_price=100, initial_stop=97, shares=10, rule="pct_8")
    assert result["exit_price"] == pytest.approx(96.0)  # min(open 96, stop 97) — day 2's low (95) breaches 97
    assert result["hold"] == 2
    assert result["mtm"] is False


def test_pct8_ratchets_up_after_a_new_closing_high():
    # A new closing high (130) lifts the stop from 97 to 130*0.92=119.6, well
    # above the initial 97 — day 3's low (100) then breaches it.
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 98, "c": 105},  # peak_close 105, stop max(97, 96.6)=97
            {"date": _d(2), "o": 106, "h": 131, "l": 105, "c": 130},  # peak_close 130, stop max(97, 119.6)=119.6
            {"date": _d(3), "o": 118, "h": 121, "l": 100, "c": 115},  # low 100 <= 119.6
        ]
    )
    result = replay_position(bars, entry_price=100, initial_stop=97, shares=10, rule="pct_8")
    assert result["exit_price"] == pytest.approx(min(118, 119.6))
    assert result["hold"] == 3
    assert result["mtm"] is False


# ---------- (c) half_2r sells half at +2R, share-weighted R ----------


def test_half_2r_sells_half_at_target_then_trails_the_rest():
    # R = 100 - 90 = 10, target = 120. Day 1's high (122) reaches it: half (5
    # of 10 shares) sells at max(open, 120) = 120. Day 2 the trailing stop
    # (ratcheted to day 1's low, 104) is breached by day 2's low (100); the
    # remaining 5 shares exit at min(open, stop) = 103.
    bars = _bars(
        [
            {"date": _d(1), "o": 105, "h": 122, "l": 104, "c": 118},
            {"date": _d(2), "o": 103, "h": 106, "l": 100, "c": 102},
        ]
    )
    result = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="half_2r")
    expected_pnl = (120 - 100) * 5 + (103 - 100) * 5
    expected_r = (((120 - 100) / 10) * 5 + ((103 - 100) / 10) * 5) / 10
    assert result["pnl"] == pytest.approx(expected_pnl)
    assert result["r"] == pytest.approx(expected_r)
    assert result["exit_price"] == pytest.approx(103.0)  # the last (remaining-half) leg
    assert result["hold"] == 2
    assert result["mtm"] is False


def test_half_2r_identical_to_trail_10_when_target_never_reached():
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 95, "c": 100},
            {"date": _d(2), "o": 97, "h": 99, "l": 93, "c": 94},
        ]
    )
    half = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="half_2r")
    trail = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="trail_10")
    assert half == trail


# ---------- (d) a position that never stops out is marked to the last close ----------


def test_never_stopped_out_marks_to_last_close():
    # Lows and the trail keep climbing together; nothing ever breaches.
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 99, "c": 100},
            {"date": _d(2), "o": 102, "h": 105, "l": 101, "c": 103},
            {"date": _d(3), "o": 103, "h": 106, "l": 102, "c": 105},
        ]
    )
    result = replay_position(bars, entry_price=100, initial_stop=80, shares=10, rule="trail_10")
    assert result["mtm"] is True
    assert result["exit_price"] == pytest.approx(105.0)  # the last close
    assert result["exit_date"] == _d(3)
    assert result["hold"] == 3
    assert result["r"] == pytest.approx((105 - 100) / (100 - 80))
    assert result["pnl"] == pytest.approx((105 - 100) * 10)


# ---------- (e) summarize computes max_dd from the cumulative $ P&L path ----------


def test_summarize_max_dd_from_pnl_path():
    results = [
        {"pnl": 100.0, "r": 0.5, "hold": 3, "entry_date": "2026-01-01"},
        {"pnl": -300.0, "r": -1.0, "hold": 5, "entry_date": "2026-01-02"},
        {"pnl": 50.0, "r": 0.2, "hold": 2, "entry_date": "2026-01-03"},
    ]
    metrics = summarize(results)
    assert metrics["trades"] == 3
    assert metrics["total_pnl"] == pytest.approx(-150.0)
    assert metrics["max_dd"] == pytest.approx(-0.03)
    assert metrics["win_rate"] == pytest.approx(2 / 3)
    assert metrics["avg_hold"] == pytest.approx(10 / 3)


def test_summarize_empty_is_zero_trades():
    metrics = summarize([])
    assert metrics["trades"] == 0
    assert metrics["avg_r"] is None
