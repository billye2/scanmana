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


# ---------- (e) kullamagi: the Auto book's live exit ----------


def test_kullamagi_sells_half_on_day_4_when_up_then_stops_the_rest_at_breakeven():
    # Entry day = 1, so bars[0] is day 2. Day 4 opens at 105 with day 3 having
    # closed at 104 > 100: half (5 of 10) sells at the open and the stop moves
    # to breakeven (100). Day 5's low (99) breaches it: the rest exits at
    # min(open, stop) = 100. The 10-session average never gets above the close.
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 99, "c": 102},
            {"date": _d(2), "o": 102, "h": 105, "l": 101, "c": 104},
            {"date": _d(3), "o": 105, "h": 106, "l": 103, "c": 105},
            {"date": _d(4), "o": 104, "h": 104, "l": 99, "c": 100},
        ]
    )
    result = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi", pre_closes=[100] * 10)
    assert result["pnl"] == pytest.approx((105 - 100) * 5 + (100 - 100) * 5)
    assert result["r"] == pytest.approx((((105 - 100) / 10) * 5 + 0) / 10)
    assert result["exit_price"] == pytest.approx(100.0)
    assert result["hold"] == 4
    assert result["mtm"] is False


def test_kullamagi_skips_the_partial_when_day_3_closed_under_entry():
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 99, "c": 102},
            {"date": _d(2), "o": 101, "h": 102, "l": 98, "c": 99.5},
            {"date": _d(3), "o": 99, "h": 101, "l": 98, "c": 100.5},
            {"date": _d(4), "o": 100, "h": 101, "l": 89, "c": 90},
        ]
    )
    # Prior closes at 95 keep the 10-session average under every close here, so only the partial rule is in play.
    result = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi", pre_closes=[95] * 10)
    # No partial, stop never moved: the day-5 breach exits all ten at the 90 stop for −1R.
    assert result["r"] == pytest.approx(-1.0)
    assert result["exit_price"] == pytest.approx(90.0)
    assert result["hold"] == 4


def test_kullamagi_sells_at_the_next_open_after_a_close_under_the_10_day_average():
    # Ten closes at 100 then 99: the average is 99.9, the close is under it, so
    # the whole position sells at day 3's open (98.5). The stop (90) was never hit.
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 102, "l": 98, "c": 99},
            {"date": _d(2), "o": 98.5, "h": 100, "l": 97, "c": 99.5},
        ]
    )
    result = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi", pre_closes=[100] * 10)
    assert result["exit_price"] == pytest.approx(98.5)
    assert result["r"] == pytest.approx(-0.15)
    assert result["hold"] == 2
    assert result["mtm"] is False


def test_kullamagi_without_pre_closes_averages_what_exists():
    # One post-entry close only: the "average" is that close itself, never under it.
    bars = _bars([{"date": _d(1), "o": 101, "h": 102, "l": 98, "c": 99}])
    result = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi")
    assert result["mtm"] is True
    assert result["exit_price"] == pytest.approx(99.0)


# ---------- (f) pre-entry seeding: the trails look back across the bars before entry ----------


def test_trail10_seeds_its_window_from_pre_entry_lows_like_the_live_engine():
    # Ten lows at 92 before (and on) the entry day: the live engine's 10-bar
    # lookback puts the stop at 92 from the fill. Day 1's low of 95 does not
    # lift it (92 is still inside the window); day 2's low of 91.5 breaches it,
    # so the exit is min(open, 92) = 92 — not day 1's low of 95, which is where
    # the post-entry-only seeding (the 2026-10-25 bug) had put the stop.
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 95, "c": 100},
            {"date": _d(2), "o": 96, "h": 97, "l": 91.5, "c": 92},
        ]
    )
    seeded = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="trail_10", pre_lows=[92] * 10)
    assert seeded["exit_price"] == pytest.approx(92.0)
    assert seeded["r"] == pytest.approx(-0.8)
    unseeded = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="trail_10")
    assert unseeded["exit_price"] == pytest.approx(95.0)


def test_trail_seed_never_lowers_the_initial_stop():
    bars = _bars([{"date": _d(1), "o": 101, "h": 103, "l": 99, "c": 100}])
    result = replay_position(bars, entry_price=100, initial_stop=95, shares=10, rule="trail_5", pre_lows=[80] * 5)
    assert result["mtm"] is True  # the stop stayed at 95; nothing breached it


def test_half_2r_still_matches_trail_10_when_both_are_seeded():
    bars = _bars(
        [
            {"date": _d(1), "o": 101, "h": 103, "l": 95, "c": 100},
            {"date": _d(2), "o": 96, "h": 97, "l": 91.5, "c": 92},
        ]
    )
    half = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="half_2r", pre_lows=[92] * 10)
    trail = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="trail_10", pre_lows=[92] * 10)
    assert half == trail


def test_pct8_seeds_the_peak_at_the_entry_day_close():
    # Entry day closed at 110 (above the 100 entry). The 8% trail off that
    # peak is 101.2 once day 1 has been processed; day 2's low of 100 breaches
    # it. Seeded at entry_price instead, the stop would have been 92 and day 2
    # would have survived.
    bars = _bars(
        [
            {"date": _d(1), "o": 109, "h": 110, "l": 105, "c": 108},
            {"date": _d(2), "o": 104, "h": 105, "l": 100, "c": 101},
        ]
    )
    seeded = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="pct_8", pre_closes=[100] * 9 + [110])
    assert seeded["exit_price"] == pytest.approx(110 * 0.92)
    unseeded = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="pct_8")
    assert unseeded["mtm"] is True


# ---------- (g) the interview's two variants: 20-day exit, skip a wide stop ----------


def test_kullamagi_20_holds_through_a_close_under_the_10_day_but_over_the_20_day():
    # Ten closes at 100 then ten at 110 before entry: the 10-day average is 110,
    # the 20-day 105. A post-entry close of 108 is under the 10-day (sells at the
    # next open under the live rule) but over the 20-day (the 20-day rule holds).
    pre = [100] * 10 + [110] * 10
    bars = _bars(
        [
            {"date": _d(1), "o": 109, "h": 110, "l": 107, "c": 108},
            {"date": _d(2), "o": 107, "h": 109, "l": 106, "c": 108.5},
        ]
    )
    ten = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi", pre_closes=pre)
    twenty = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi_20", pre_closes=pre)
    assert ten["exit_price"] == pytest.approx(107.0)  # sold at day 3's open
    assert ten["mtm"] is False
    assert twenty["mtm"] is True  # still held, marked to the last close
    assert twenty["exit_price"] == pytest.approx(108.5)


def test_kullamagi_adr_skips_a_stop_wider_than_one_adr_and_trades_a_tighter_one():
    bars = _bars([{"date": _d(1), "o": 101, "h": 103, "l": 99, "c": 102}])
    # Stop 10% under the entry, ADR 5%: not taken — zero R, zero hold.
    wide = replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi_adr", adr=0.05)
    assert wide == {"exit_price": 90.0, "exit_date": _d(1), "hold": 0, "r": 0.0, "pnl": 0.0, "mtm": False, "skipped": True}
    # Stop 4% under with the same ADR: identical to the live rule.
    tight = replay_position(bars, entry_price=100, initial_stop=96, shares=10, rule="kullamagi_adr", adr=0.05)
    live = replay_position(bars, entry_price=100, initial_stop=96, shares=10, rule="kullamagi")
    assert tight == live
    # Without an ADR the rule cannot judge width and trades like the live rule.
    assert replay_position(bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi_adr") == replay_position(
        bars, entry_price=100, initial_stop=90, shares=10, rule="kullamagi"
    )


def test_adr_pct_mirrors_the_typescript_indicator():
    from research.replay import adr_pct

    pre = pd.DataFrame({"h": [105.0] * 20, "l": [100.0] * 20})
    assert adr_pct(pre) == pytest.approx(0.05)
    assert adr_pct(pre.head(19)) is None
