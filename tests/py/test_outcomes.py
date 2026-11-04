import numpy as np
import pytest
import pandas as pd

from research.outcomes import HORIZON, breakout_level, label_frame, label_one


def _after(closes, highs=None, lows=None, opens=None):
    n = len(closes)
    c = np.asarray(closes, dtype=float)
    return pd.DataFrame(
        {
            "o": np.asarray(opens if opens is not None else c, dtype=float),
            "h": np.asarray(highs if highs is not None else c * 1.01, dtype=float),
            "l": np.asarray(lows if lows is not None else c * 0.99, dtype=float),
            "c": c,
        }
    )


def test_breakout_within_ten_sessions():
    after = _after([100, 101, 103, 106, 107, 108, 109, 110, 111, 112, 113, 114])
    out = label_one(after, scan_close=100, level=105, box_top=None, box_bottom=None)
    assert out["broke_10d"] is True
    assert out["broke_day"] == 4
    assert out["sessions_after"] == 12
    assert out["complete"] is False


def test_no_breakout_is_false_only_after_ten_sessions():
    flat = _after([100] * 8)
    assert label_one(flat, 100, 105, None, None)["broke_10d"] is None
    flat10 = _after([100] * 10)
    assert label_one(flat10, 100, 105, None, None)["broke_10d"] is False


def test_excursions_are_relative_to_scan_close():
    after = _after([110, 90, 100, 105, 120] + [100] * 15)
    out = label_one(after, 100, None, None, None)
    assert out["mfe_5"] == pytest.approx(0.2)
    assert out["mae_5"] == pytest.approx(-0.1)
    assert out["mfe_20"] == pytest.approx(0.2)
    assert out["complete"] is True
    assert out["broke_10d"] is None  # no level


def test_auto_trade_fills_at_box_top_and_stops_at_min_open_stop():
    # Box 100/90. Day 1 high touches 100 → fill at max(open 99, 100) = 100. Day 3 gaps to 85 → exit at min(open 85, stop 90) = 85.
    after = _after(closes=[99.5, 101, 84], highs=[100.5, 102, 86], lows=[98, 100, 83], opens=[99, 100.5, 85])
    out = label_one(after, 98, 100, 100, 90)
    assert out["filled"] is True
    assert out["r_at_exit"] == (85 - 100) / 10


def test_trail_raises_stop_after_ten_lows():
    # Fill day 1 at 100 (box 100/90). Then 12 sessions rising with lows well above 90, then a drop to the trailed stop.
    closes = [100.5] + [100 + i for i in range(1, 13)] + [95]
    lows = [99.0] + [99.5 + i for i in range(1, 13)] + [90.0]
    highs = [100.2] + [101 + i for i in range(1, 13)] + [96]
    opens = [99.8] + [100 + i for i in range(1, 13)] + [95.5]
    after = _after(closes, highs, lows, opens)
    out = label_one(after, 98, 100, 100, 90)
    # after 12 rising sessions the 10-low trail sits at lows[3] = 102.5 (min of the last 10 lows before the drop)
    assert out["filled"] is True
    assert out["r_at_exit"] == (min(95.5, 102.5) - 100) / 10
    assert out["complete"] is False  # only 14 sessions after


def test_unfilled_after_horizon_marks_filled_false():
    after = _after([95] * HORIZON, highs=[96] * HORIZON)
    out = label_one(after, 95, 100, 100, 90)
    assert out["filled"] is False
    assert out["r_at_exit"] is None


def test_label_frame_aligns_on_scan_date_and_skips_missing():
    dates = pd.date_range("2026-08-03", periods=25, freq="B")
    bars = pd.DataFrame(
        {
            "ticker": ["AAA"] * 25,
            "date": dates,
            "o": 100.0, "h": 101.0, "l": 99.0, "c": np.linspace(100, 124, 25),
            "v": 1e6,
        }
    )
    rows = pd.DataFrame(
        [
            {"date": dates[2], "ticker": "AAA", "close": 102.0, "boxed": False, "box_top": None, "box_bottom": None, "pivot": 105.0},
            {"date": pd.Timestamp("2026-07-01"), "ticker": "AAA", "close": 1.0, "boxed": False, "box_top": None, "box_bottom": None, "pivot": 1.0},
            {"date": dates[2], "ticker": "ZZZ", "close": 1.0, "boxed": False, "box_top": None, "box_bottom": None, "pivot": 1.0},
        ]
    )
    out = label_frame(rows, bars)
    assert len(out) == 1
    row = out[0]
    assert row[1] == "AAA"
    assert row[3] is True  # broke_10d: closes rise past 105 within 10 sessions
    from research.outcomes import COMPLETE_COL

    assert row[COMPLETE_COL] is True  # complete: 22 sessions after
    assert len(row) == len(__import__("research.outcomes", fromlist=["COLUMNS"]).COLUMNS)


def test_breakout_level_prefers_box_then_overhead_pivot_then_20d_high():
    assert breakout_level(100, True, 104, 90, 110) == 104
    assert breakout_level(100, False, None, 103, 110) == 103  # pivot still overhead
    assert breakout_level(100, False, None, 95, 108) == 108  # pivot already broken → fresh high
    assert breakout_level(100, False, None, None, 99) == 100  # never below the close
    assert breakout_level(100, False, None, None, None) is None


def test_label_frame_uses_the_20_session_high_when_pivot_is_below_close():
    # 25 sessions of history before the scan with a 120 high on the 5th, then the scan at 100 with pivot 90.
    n_before = 25
    dates = pd.date_range("2026-01-05", periods=n_before + 1 + 12, freq="B")
    highs = [101.0] * n_before + [100.5] + [105.0] * 12
    highs[4] = 120.0  # outside the 20-session window ending on the scan day
    highs[10] = 112.0  # inside it → the level
    closes = [100.0] * (n_before + 1) + [104.0] * 6 + [113.0] * 6
    bars = pd.DataFrame({"ticker": "T", "date": dates, "o": closes, "h": highs, "l": [99.0] * len(dates), "c": closes})
    rows = pd.DataFrame([{"date": dates[n_before], "ticker": "T", "close": 100.0, "boxed": False,
                          "box_top": None, "box_bottom": None, "pivot": 90.0}])
    out = label_frame(rows, bars)
    assert len(out) == 1
    rec = dict(zip(["date", "ticker", "level", "broke_10d", "broke_day"], out[0][:5]))
    assert rec["level"] == 112.0
    assert rec["broke_10d"] is True
    assert rec["broke_day"] == 7


# ---------- the plan the Auto book trades, and the resting buy-stop ----------

from research.outcomes import kullamagi_plans  # noqa: E402
from research.replay import _replay_kullamagi  # noqa: E402


def _plan_after():
    # Scan close 100 under a 105 box top. Day 3 closes above the top (106); day 4 opens 108.
    closes = [100, 101, 106, 108, 110, 112, 111, 113, 115, 114, 116, 118, 117, 119, 120, 121, 122, 123, 124, 125]
    return _after(closes)


def test_next_open_plan_enters_the_open_after_the_first_close_above_the_box():
    after = _plan_after()
    out = kullamagi_plans(after, scan_close=100, box_top=105, adr=0.04, pre_closes=[99, 100])
    assert out["k_entry_day"] == 4
    entry, stop = 108.0, 106 * 0.99  # day-4 open, day-3 low
    assert out["k_stop_adr"] == pytest.approx((entry - stop) / entry / 0.04)
    rest = after.assign(date=np.arange(len(after))).iloc[4:]
    expected = _replay_kullamagi(rest, entry, stop, 100, [99, 100, 100, 101, 106, 108])
    assert out["k_r"] == pytest.approx(expected["r"])


def test_next_open_plan_is_cancelled_when_that_open_is_under_the_stop():
    after = _plan_after()
    opens = after["c"].to_numpy().copy()
    opens[3] = 104.0  # gaps back under the breakout day's low (104.94)
    after = after.assign(o=opens)
    out = kullamagi_plans(after, 100, 105, 0.04, [100])
    assert out["k_entry_day"] is None and out["k_r"] is None
    assert out["bs_entry_day"] == 3  # the buy-stop filled on the breakout day regardless


def test_next_open_plan_books_a_same_day_stop_out_at_minus_one_r():
    after = _plan_after()
    lows = after["l"].to_numpy().copy()
    lows[3] = 104.0  # the entry day trades through the stop
    after = after.assign(l=lows)
    assert kullamagi_plans(after, 100, 105, 0.04, [100])["k_r"] == -1.0


def test_plans_are_none_for_a_card_already_above_its_box_and_without_a_top():
    after = _plan_after()
    assert all(v is None for v in kullamagi_plans(after, 106, 105, 0.04, [100]).values())
    assert all(v is None for v in kullamagi_plans(after, 100, None, 0.04, [100]).values())


def test_buy_stop_plan_fills_at_the_top_with_a_one_adr_stop():
    after = _plan_after()  # day 3 high 107.06 is the first high at or above 105
    out = kullamagi_plans(after, 100, 105, 0.04, [100])
    assert out["bs_entry_day"] == 3
    assert out["bs_stop_adr"] == 1.0
    fill, stop = 106.0, 106.0 * 0.96  # max(open 106, top 105); one ADR under
    rest = after.assign(date=np.arange(len(after))).iloc[3:]
    expected = _replay_kullamagi(rest, fill, stop, 100, [100, 100, 101, 106])
    assert out["bs_r"] == pytest.approx(expected["r"])
    # Without an ADR there is no width and no buy-stop plan, but the next-open plan still scores.
    bare = kullamagi_plans(after, 100, 105, None, [100])
    assert bare["bs_r"] is None and bare["k_stop_adr"] is None and bare["k_r"] is not None


def test_plan_r_is_none_while_open_inside_an_incomplete_window():
    after = _after([100, 101, 106, 108, 110, 112])  # six sessions, trade still open
    out = kullamagi_plans(after, 100, 105, 0.04, [100])
    assert out["k_entry_day"] == 4 and out["k_r"] is None


def test_label_one_carries_the_plan_columns():
    out = label_one(_plan_after(), 100, 105, 105, 95, 0.04, [100])
    assert out["k_entry_day"] == 4 and out["bs_entry_day"] == 3
    assert label_one(_after([100] * 3), 100, 105, None, None)["k_r"] is None
