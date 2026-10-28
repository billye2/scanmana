"""Hand-built-bar tests for research/ep.py — no database needed.

One ticker's bars with a gap day at a known index; the labeller must read the
neglect features from the bars before it and price the trade from the next
open with the stop at the gap day's low.
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from research.ep import (
    CANDIDATE_SQL,
    COLUMNS,
    HORIZON,
    MAX_GAP,
    MIN_GAP,
    MIN_VOL_MULT,
    VOL_WINDOW,
    label_ep,
    label_frame,
)


def _flat(n: int, price: float = 20.0, vol: float = 1_000_000.0, start: date = date(2026, 1, 2)) -> list[dict]:
    """n quiet sessions: open = close = price, a 2% range, steady volume."""
    return [
        {"date": pd.Timestamp(start + timedelta(days=k)), "o": price, "h": price * 1.01, "l": price * 0.99, "c": price, "v": vol}
        for k in range(n)
    ]


def _gap_then(after: list[dict], neglected_days: int = 140, gap_open: float = 24.0, gap_low: float = 23.0, gap_close: float = 25.0, gap_vol: float = 10_000_000.0) -> pd.DataFrame:
    rows = _flat(neglected_days)
    last = rows[-1]["date"]
    rows.append({"date": last + timedelta(days=1), "o": gap_open, "h": gap_close * 1.02, "l": gap_low, "c": gap_close, "v": gap_vol})
    for k, r in enumerate(after, start=2):
        rows.append({"date": last + timedelta(days=k), **r})
    df = pd.DataFrame(rows)
    df["ticker"] = "EPX"
    return df


def test_features_read_the_bars_before_the_gap():
    df = _gap_then([{"o": 25, "h": 26, "l": 24.5, "c": 25.5, "v": 5e6}])
    i = 140  # the gap day
    lab = label_ep(df, i)
    assert lab["gap_pct"] == pytest.approx(24 / 20 - 1)
    assert lab["vol_mult"] == pytest.approx(10.0)
    assert lab["day_pct"] == pytest.approx(25 / 20 - 1)
    assert lab["held_gap"] is True  # closed 25 above the 24 open
    assert lab["ret_3m_before"] == pytest.approx(0.0)  # flat for months: the neglected shape
    assert lab["ret_6m_before"] == pytest.approx(0.0)
    assert lab["dist_high_before"] == pytest.approx(1 - 20 / 20.2)  # under the 1% intraday highs
    assert lab["entry"] == pytest.approx(25.0)  # the next session's open
    assert lab["stop"] == pytest.approx(23.0)  # the gap day's low
    assert lab["taken"] is True
    assert lab["sessions_after"] == 1
    assert lab["complete"] is False
    assert lab["r_at_exit"] is None  # one session: no exit, not yet HORIZON


def test_not_taken_when_the_next_open_is_under_the_gap_day_low():
    df = _gap_then([{"o": 22.5, "h": 23, "l": 22, "c": 22.4, "v": 5e6}])
    lab = label_ep(df, 140)
    assert lab["taken"] is False
    assert lab["r_at_exit"] is None


def test_same_day_stop_out_books_minus_one_r():
    df = _gap_then([{"o": 25, "h": 25.5, "l": 22.9, "c": 23.2, "v": 5e6}])
    lab = label_ep(df, 140)
    assert lab["taken"] is True
    assert lab["r_at_exit"] == pytest.approx(-1.0)
    assert lab["hold"] == 1


def test_outcome_replays_the_kullamagi_exit_and_marks_mfe_over_the_horizon():
    # The entry day (first row after the gap) opens at 25.5: entry 25.5, stop 23,
    # risk 2.5. Counting the entry day as 1: day 2 closes 29, day 3 closes 29.5
    # (above entry), so day 4 sells half at its open (29) and the stop goes to
    # breakeven (25.5). Day 5's low (24) breaches it: the rest fills at
    # min(open 24.8, 25.5) = 24.8. Share-weighted R over the two legs.
    after = [
        {"o": 25.5, "h": 28.5, "l": 25.2, "c": 28, "v": 5e6},  # entry day
        {"o": 28, "h": 29.5, "l": 27.5, "c": 29, "v": 5e6},
        {"o": 29.3, "h": 30.5, "l": 29, "c": 29.5, "v": 5e6},
        {"o": 29, "h": 29.5, "l": 26, "c": 27, "v": 5e6},
        {"o": 24.8, "h": 25.2, "l": 24, "c": 24.5, "v": 5e6},
    ]
    after += [{"o": 24.5, "h": 24.8, "l": 24.2, "c": 24.6, "v": 5e6}] * (HORIZON + 1 - len(after))
    df = _gap_then(after)
    lab = label_ep(df, 140)
    assert lab["entry"] == pytest.approx(25.5)
    assert lab["r_at_exit"] == pytest.approx(((29 - 25.5) / 2.5 * 50 + (24.8 - 25.5) / 2.5 * 50) / 100)
    assert lab["hold"] == 5  # entry day + four sessions
    assert lab["mfe_20"] == pytest.approx(29.5 / 25.5 - 1)
    assert lab["mae_20"] == pytest.approx(24.5 / 25.5 - 1)
    assert lab["complete"] is True


def test_label_frame_writes_rows_in_column_order():
    df = _gap_then([{"o": 25, "h": 26, "l": 24.5, "c": 25.5, "v": 5e6}])
    cands = pd.DataFrame([{"ticker": "EPX", "date": df["date"].iloc[140]}])
    rows = label_frame(cands, df)
    assert len(rows) == 1
    assert len(rows[0]) == len(COLUMNS)
    assert rows[0][0] == df["date"].iloc[140].date()
    assert rows[0][1] == "EPX"
    assert rows[0][COLUMNS.index("entry")] == pytest.approx(25.0)


def test_candidate_sql_matches_the_badge_floors():
    """The SQL carries the module constants, which mirror lib/config.ts CONFIG.EP."""
    assert MIN_GAP == 0.10 and MIN_VOL_MULT == 3.0 and VOL_WINDOW == 20 and MAX_GAP == 1.0
    sql = CANDIDATE_SQL.format(n=VOL_WINDOW, since_clause="", emit_clause="")
    assert f"ROWS BETWEEN {VOL_WINDOW} PRECEDING AND 1 PRECEDING" in sql
    assert "%(min_gap)s" in sql and "%(vol_mult)s" in sql and "%(min_price)s" in sql and "%(min_dv)s" in sql
