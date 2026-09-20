import re
from pathlib import Path

import numpy as np
import pandas as pd

from research.sweep import CURRENT, GRIDS, cap_deck, sweep

ROOT = Path(__file__).resolve().parents[2]


def _ts_number(src: str, key: str) -> float:
    m = re.search(rf"\b{key}:\s*([0-9_.]+)", src)
    assert m, key
    return float(m.group(1).replace("_", ""))


def test_grids_match_typescript_limits():
    """The loosest grid value must equal lib/screen.ts LOOSE_LIMITS and CURRENT must equal lib/config.ts."""
    screen = (ROOT / "lib" / "screen.ts").read_text()
    loose = screen[screen.index("LOOSE_LIMITS") :]
    for key in ("MIN_PRICE", "MIN_DOLLAR_VOLUME", "MIN_ADR_PCT", "MAX_DIST_FROM_HIGH"):
        grid = GRIDS[key]
        loosest = min(grid) if key != "MAX_DIST_FROM_HIGH" else max(grid)
        assert loosest == _ts_number(loose, key), key
    config = (ROOT / "lib" / "config.ts").read_text()
    for key, val in CURRENT.items():
        assert val == _ts_number(config, key), key
        assert val in GRIDS[key], key


def _history(n_dates=3, per_date=80, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for d in pd.date_range("2026-08-03", periods=n_dates, freq="B"):
        for i in range(per_date):
            rows.append(
                {
                    "date": d, "ticker": f"T{i}",
                    "close": rng.uniform(5, 60), "dollar_vol": rng.uniform(5e6, 6e7), "adr_pct": rng.uniform(2.5, 7),
                    "dist_from_high": rng.uniform(0, 0.3), "tightness": rng.uniform(0.3, 3), "boxed": bool(rng.random() < 0.5),
                    "broke_10d": bool(rng.random() < 0.35), "r_at_exit": rng.normal(0.3, 1.0),
                }
            )
    return pd.DataFrame(rows)


def test_cap_deck_boxed_first_tightest_first_per_date():
    df = _history(per_date=100)
    capped = cap_deck(df, max_results=10)
    assert capped.groupby("date").size().max() == 10
    for _, g in capped.groupby("date"):
        boxed = g["boxed"].to_numpy()
        # once a non-boxed row appears, no boxed row follows
        seen_unboxed = False
        for b in boxed:
            if not b:
                seen_unboxed = True
            assert not (seen_unboxed and b)


def test_sweep_current_row_is_flagged_and_monotone_deck_size():
    df = _history()
    out = sweep(df)
    assert len(out) == sum(len(v) for v in GRIDS.values())
    current = [r for r in out if r["is_current"]]
    assert {r["param"] for r in current} == set(GRIDS)
    # a higher dollar-volume floor can only shrink the deck
    dv = [r["deck_size"] for r in out if r["param"] == "MIN_DOLLAR_VOLUME"]
    assert dv == sorted(dv, reverse=True)
    dist = [r["deck_size"] for r in out if r["param"] == "MAX_DIST_FROM_HIGH"]
    assert dist == sorted(dist)
    for r in out:
        assert r["hit_rate"] is None or 0 <= r["hit_rate"] <= 1


def test_sweep_empty_frame():
    assert sweep(pd.DataFrame()) == []
