import numpy as np
import pandas as pd
import pytest

from research.mc import QUANTILES, book_r, fan, percentile_of, simulate


def test_simulate_is_deterministic_and_cumulative():
    rs = np.array([-1.0, 2.0, 0.5])
    a = simulate(rs, 10, shuffles=200)
    b = simulate(rs, 10, shuffles=200)
    assert a.shape == (200, 10) and np.array_equal(a, b)
    assert np.all(np.isin(a[:, 0], rs))  # the first step is one draw
    assert np.all(np.isin(np.round(np.diff(a, axis=1), 9), rs))  # every step adds one draw


def test_fan_quantiles_are_ordered_and_widen():
    sims = simulate(np.array([-1.0, 1.0, 3.0]), 60, shuffles=2000)
    bands = fan(sims)
    assert bands.shape == (60, len(QUANTILES))
    assert np.all(np.diff(bands, axis=1) >= 0)  # q05 <= q25 <= ... per row
    assert bands[59, 4] - bands[59, 0] > bands[4, 4] - bands[4, 0]  # the fan opens with more trades


def test_percentile_of_reads_the_share_under_the_book():
    sims = np.array([[0.0, 1.0], [0.0, 2.0], [0.0, 3.0], [0.0, 4.0]])
    assert percentile_of(sims, 2, 2.5) == 0.5
    assert percentile_of(sims, 2, 0.0) == 0.0
    assert percentile_of(sims, 2, 10.0) == 1.0


def test_book_r_mirrors_closed_trades():
    rows = pd.DataFrame(
        [
            {"entry_date": "2026-10-27", "id": 1, "entry_price": 100.0, "initial_stop": 95.0, "proceeds": 1050.0, "sold": 10},
            {"entry_date": "2026-10-28", "id": 2, "entry_price": 100.0, "initial_stop": 100.0, "proceeds": 900.0, "sold": 10},  # no risk: skipped
            {"entry_date": "2026-10-29", "id": 3, "entry_price": 50.0, "initial_stop": 48.0, "proceeds": 470.0, "sold": 10},
        ]
    )
    assert book_r(rows) == pytest.approx([1.0, -1.5])  # (47 - 50) / (50 - 48)
