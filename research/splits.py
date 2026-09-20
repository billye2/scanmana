"""Split detection and adjustment factors (research_splits).

Bars are stored unadjusted, so a split shows up as a big overnight gap with a
matching (inverse) volume jump. `factor` is the multiplier for prices BEFORE
the split date to bring them onto the post-split scale (volume is divided by
it): a 1:3 reverse split has factor 3, a 4:1 forward split has factor 0.25.
"""
from __future__ import annotations

from datetime import timedelta

import pandas as pd
import psycopg

from .db import load_bars, pyval, read_df, write_rows
from .util import JobContext, as_date

LOOKBACK_DAYS = 400  # calendar days of bars to load (matches CONFIG.PRUNE_DAYS)

# "Clean" split ratios. Reverse: g ~= R. Forward: g ~= 1/R.
REVERSE_RATIOS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 100]
FORWARD_RATIOS = [2, 3, 4, 5, 10, 20, 1.5, 2.5]
CLEAN_MULTIPLIERS = [float(r) for r in REVERSE_RATIOS] + [1.0 / r for r in FORWARD_RATIOS]

GAP_THRESHOLD = 1.5  # candidate gap: g >= 1.5 or g <= 1/1.5
GAP_CLEAN_TOL = 0.04
CLOSE_CLEAN_TOL = 0.12
VOL_RATIO_TOL = 0.35
REVERSAL_TOL = 0.25
# A split day trades like any other day once rescaled. A news day does not:
# the range blows out and volume spikes far past what the share-count change
# explains. Either sign costs NEWS_PENALTY, which keeps a clean-looking ratio
# out of 'auto' (0.5 + 0.4 + 0.1 - 0.3 < AUTO_CONFIDENCE) but at the top of the
# review list.
RANGE_SPIKE_MAX = 2.5  # day range (h-l)/c vs the prior 20-session median range
DAY_VOL_SPIKE_MAX = 4.0  # day volume vs prior 20-session median volume × the expected multiple
NEWS_PENALTY = 0.3
MIN_CONFIDENCE = 0.5  # clean ratio alone, or an unclean gap with the volume signature
AUTO_CONFIDENCE = 0.9

SPLITS_COLUMNS = ["ticker", "date", "ratio", "gap_pct", "vol_ratio", "confidence", "status", "factor"]


def _clean_match(g: float, cr: float) -> float | None:
    """Best clean multiplier matching both the gap ratio and the close ratio, or None."""
    best: float | None = None
    best_err: float | None = None
    for m in CLEAN_MULTIPLIERS:
        g_err = abs(g / m - 1.0)
        if g_err > GAP_CLEAN_TOL:
            continue
        if abs(cr / m - 1.0) > CLOSE_CLEAN_TOL:
            continue
        if best is None or g_err < best_err:
            best, best_err = m, g_err
    return best


def _traded_like_news(day_range: float, range_med: float, day_vol: float, vol_med: float, g: float) -> bool:
    """True when the gap day's range or volume is far beyond what a plain rescale explains."""
    if pd.notna(day_range) and pd.notna(range_med) and range_med > 0:
        if day_range / range_med > RANGE_SPIKE_MAX:
            return True
    if pd.notna(day_vol) and pd.notna(vol_med) and vol_med > 0 and g > 0:
        expected = vol_med / g  # a 2:1 forward split (g = 0.5) doubles the share count
        if day_vol / expected > DAY_VOL_SPIKE_MAX:
            return True
    return False


def detect_splits(bars: pd.DataFrame) -> pd.DataFrame:
    """Candidate splits from unadjusted bars (ticker, date, o, h, l, c, v).

    Pure over the DataFrame passed in — no I/O. Output columns: ticker, date,
    ratio, gap_pct, vol_ratio, confidence, status, factor, clean.
    """
    cols = ["ticker", "date", "ratio", "gap_pct", "vol_ratio", "confidence", "status", "factor", "clean"]
    if bars.empty:
        return pd.DataFrame(columns=cols)

    results: list[dict] = []
    for ticker, df in bars.sort_values(["ticker", "date"]).groupby("ticker", sort=False):
        df = df.reset_index(drop=True)
        if len(df) < 2:
            continue
        c = df["c"]
        o = df["o"]
        v = df["v"]

        prev_close = c.shift(1)
        g = o / prev_close
        cr = c / prev_close

        roll5_v = v.rolling(5, min_periods=5).median()
        vol_before = roll5_v.shift(1)
        vol_after = roll5_v.shift(-4)
        vol_ratio = vol_after / vol_before

        roll5_c = c.rolling(5, min_periods=5).median()
        next5_median = roll5_c.shift(-5)

        day_range = (df["h"] - df["l"]) / c
        range_med20 = day_range.rolling(20, min_periods=10).median().shift(1)
        vol_med20 = v.rolling(20, min_periods=10).median().shift(1)

        for i in range(len(df)):
            gi = g.iloc[i]
            if pd.isna(gi) or gi == 0:
                continue
            if not (gi >= GAP_THRESHOLD or gi <= 1.0 / GAP_THRESHOLD):
                continue

            cri = cr.iloc[i]
            m = _clean_match(gi, cri) if pd.notna(cri) else None
            clean = m is not None
            confidence = 0.5 if clean else 0.15

            vr = vol_ratio.iloc[i]
            if pd.notna(vr):
                inv_g = 1.0 / gi
                if inv_g != 0 and abs(vr / inv_g - 1.0) <= VOL_RATIO_TOL:
                    confidence += 0.4

            n5 = next5_median.iloc[i]
            day_close = c.iloc[i]
            if pd.notna(n5) and day_close not in (0, None) and pd.notna(day_close):
                if abs(n5 / day_close - 1.0) <= REVERSAL_TOL:
                    confidence += 0.1

            confidence = min(confidence, 1.0)
            if _traded_like_news(day_range.iloc[i], range_med20.iloc[i], v.iloc[i], vol_med20.iloc[i], gi):
                confidence -= NEWS_PENALTY
            if confidence < MIN_CONFIDENCE:
                continue

            factor = m if clean else gi
            status = "auto" if (clean and confidence >= AUTO_CONFIDENCE) else "review"

            results.append(
                {
                    "ticker": ticker,
                    "date": df["date"].iloc[i],
                    "ratio": float(factor),
                    "gap_pct": float(gi - 1.0),
                    "vol_ratio": None if pd.isna(vr) else float(vr),
                    "confidence": float(confidence),
                    "status": status,
                    "factor": float(factor),
                    "clean": bool(clean),
                }
            )

    if not results:
        return pd.DataFrame(columns=cols)
    return pd.DataFrame(results, columns=cols)


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    """Detect split candidates and upsert research_splits, preserving 'ignored' rows."""
    scan_date = as_date(ctx.scan_date)
    since = (scan_date - timedelta(days=LOOKBACK_DAYS)).isoformat()
    bars = load_bars(conn, since=since)
    if bars.empty:
        return "0 candidates: 0 auto, 0 review"

    detected = detect_splits(bars)

    ignored_df = read_df(conn, "SELECT ticker, date::text AS date FROM research_splits WHERE status = 'ignored'")
    ignored = set(zip(ignored_df["ticker"], ignored_df["date"])) if not ignored_df.empty else set()

    if not detected.empty:
        detected = detected.copy()
        detected["date_str"] = detected["date"].apply(lambda d: as_date(d).isoformat())
        keep = detected[~detected.apply(lambda r: (r["ticker"], r["date_str"]) in ignored, axis=1)]
    else:
        keep = detected

    rows = [
        (
            pyval(r.ticker),
            pyval(as_date(r.date)),
            pyval(r.ratio),
            pyval(r.gap_pct),
            pyval(r.vol_ratio),
            pyval(r.confidence),
            pyval(r.status),
            pyval(r.factor),
        )
        for r in keep.itertuples()
    ]
    n = write_rows(conn, "research_splits", SPLITS_COLUMNS, rows, conflict=["ticker", "date"])

    detected_keys = set(zip(keep["ticker"], keep["date_str"])) if not keep.empty else set()
    current = read_df(conn, "SELECT ticker, date::text AS date FROM research_splits WHERE status != 'ignored'")
    to_delete = [
        (t, d) for t, d in zip(current["ticker"], current["date"]) if (t, d) not in detected_keys
    ] if not current.empty else []
    if to_delete:
        with conn.cursor() as cur:
            cur.executemany(
                "DELETE FROM research_splits WHERE ticker = %s AND date = %s AND status != 'ignored'",
                to_delete,
            )

    n_auto = int((keep["status"] == "auto").sum()) if not keep.empty else 0
    n_review = int((keep["status"] == "review").sum()) if not keep.empty else 0
    return f"{n} candidates: {n_auto} auto, {n_review} review"
