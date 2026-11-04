"""Theme clustering from price alone (research_clusters, research_cluster_members,
research_cluster_history).

Groups the liquid universe by 63-session return correlation (hierarchical,
average linkage, distance = 1 - corr). The equal-weight market return is
regressed out of every name first, so the clusters are themes rather than one
giant "everything moves with the tape" blob. Never touches
research_cluster_alias — that table holds user-authored names keyed by
cluster_key and, since 1.7.8, by theme_id.

Stable theme ids (1.7.8, R3 of the Python-studies plan): each night's clusters
are chained to the themes seen on the ten nights before by member overlap
(Jaccard >= THEME_MIN_JACCARD keeps the id, greedily from the strongest
overlap, so a split keeps the id on its larger half and a merge takes the
theme it overlaps most; anything else is a new id; a theme unseen for
THEME_GAP_NIGHTS nights ends). theme_id lands on research_cluster_history and
research_clusters; research_themes keeps one row per theme (first and last
night, nights seen, the latest key). Nights whose history has no theme_id are
chained in date order at the end of every run, so the back-fill of the saved
history happens on its own over a run or two.
"""
from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd
import psycopg
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

from .db import load_bars, pyval, read_df, replace_table, write_rows
from .util import JobContext, as_date, close_matrix

EXCLUDE_TICKERS = {"QQQ", "SPY", "IWM"}  # lib/config.ts CONFIG.MARKET.STORED
MIN_PRICE = 5.0  # lib/screen.ts LOOSE_LIMITS.MIN_PRICE
MIN_DOLLAR_VOLUME = 5_000_000.0  # lib/screen.ts LOOSE_LIMITS.MIN_DOLLAR_VOLUME
MIN_HISTORY_SESSIONS = 64  # 64 closes -> 63 daily log returns
MAX_UNIVERSE = 1500  # cap on the most liquid names, to bound the matrix
RETURN_WINDOW = 64  # closes fed into the correlation calc (63 returns)
UNIVERSE_LOOKBACK_DAYS = 220  # calendar days the universe query counts sessions over (aggregates only, nothing loaded)
CLOSE_LOOKBACK_DAYS = 110  # calendar days of closes loaded for the universe (>= 73 sessions > RETURN_WINDOW)

# The universe filter runs in Postgres: latest close, the 20-session average
# dollar volume (over the market's last 20 sessions, all present — the same
# thing the old rolling(20, min_periods=20) over the wide frame required) and
# the session count. Only the MAX_UNIVERSE survivors' closes leave the database.
UNIVERSE_SQL = """
WITH span AS (
  SELECT DISTINCT date FROM bars WHERE date >= %(since)s AND date <= %(until)s
),
last20 AS (SELECT date FROM span ORDER BY date DESC LIMIT 20),
agg AS (
  SELECT ticker,
    count(*) AS n_sessions,
    max(c) FILTER (WHERE date = (SELECT max(date) FROM last20)) AS latest_close,
    avg(c * v) FILTER (WHERE date IN (SELECT date FROM last20)) AS dv20,
    count(*) FILTER (WHERE date IN (SELECT date FROM last20)) AS n20
  FROM bars WHERE date >= %(since)s AND date <= %(until)s
  GROUP BY ticker
)
SELECT ticker FROM agg
WHERE NOT (ticker = ANY(%(exclude)s))
  AND latest_close >= %(min_price)s
  AND n20 = 20 AND dv20 >= %(min_dv)s
  AND n_sessions >= %(min_hist)s
ORDER BY dv20 DESC, ticker
LIMIT %(max_n)s
"""

CLUSTER_COLUMNS = ["cluster_id", "cluster_key", "leaders", "members", "member_count", "ret_63d", "as_of"]
MEMBER_COLUMNS = ["ticker", "cluster_id"]
HISTORY_COLUMNS = ["as_of", "ticker", "cluster_key", "cluster_id"]
THEME_COLUMNS = ["theme_id", "first_night", "last_night", "current_key", "nights"]
THEME_MIN_JACCARD = 0.5  # member overlap that keeps a theme's id from one night to the next
THEME_GAP_NIGHTS = 10  # a theme unseen for this many nights ends; a look-alike after that is a new theme


def jaccard(a: set[str], b: set[str]) -> float:
    """|a ∩ b| / |a ∪ b|, 0 when both are empty. Pure."""
    union = len(a | b)
    return len(a & b) / union if union else 0.0


def chain_clusters(prev: dict[int, set[str]], clusters: list[set[str]], next_id: int, min_jaccard: float = THEME_MIN_JACCARD) -> list[int]:
    """Theme id for each of tonight's clusters, in order. Pure.

    `prev` maps each live theme id to its members on the last night it was seen.
    Pairs (cluster, theme) with overlap >= min_jaccard are matched greedily from
    the largest overlap down, each side at most once — so when a theme splits,
    the half that overlaps it more keeps the id and the other half starts a new
    theme; when two themes merge, the result takes the one it overlaps more.
    Ties go to the older theme (the lower id), then to the stronger cluster
    (the lower index). Unmatched clusters take fresh ids from `next_id` up, in
    cluster order."""
    pairs = [
        (-jaccard(members, prev_members), tid, i)
        for i, members in enumerate(clusters)
        for tid, prev_members in prev.items()
        if jaccard(members, prev_members) >= min_jaccard
    ]
    assigned: dict[int, int] = {}
    taken: set[int] = set()
    for _, tid, i in sorted(pairs):
        if i in assigned or tid in taken:
            continue
        assigned[i] = tid
        taken.add(tid)
    out: list[int] = []
    for i in range(len(clusters)):
        if i in assigned:
            out.append(assigned[i])
        else:
            out.append(next_id)
            next_id += 1
    return out


def live_themes(themes: dict[int, dict], recent_nights: list) -> set[int]:
    """Theme ids whose last night is one of `recent_nights` (the THEME_GAP_NIGHTS
    most recent chained nights); the rest have ended and are not matched again. Pure."""
    recent = set(recent_nights)
    return {tid for tid, t in themes.items() if t["last_night"] in recent}


def history_rows(clusters: list[dict], scan_date) -> list[tuple]:
    """research_cluster_history rows for one night: (as_of, ticker, cluster_key, cluster_id). Pure.

    cluster_id follows the nightly numbering (1 = strongest), cluster_key is the
    stable-ish identity (the sorted leaders), so a theme can be followed across
    nights even when its rank moves.
    """
    rows = []
    for i, cl in enumerate(clusters, start=1):
        for m in cl["members"]:
            rows.append((pyval(scan_date), pyval(m), pyval(cl["cluster_key"]), pyval(i)))
    return rows


def residual_returns(log_ret: pd.DataFrame) -> pd.DataFrame:
    """Log returns with each column's beta to the equal-weight market removed. Pure."""
    mkt = log_ret.mean(axis=1)
    x = mkt - mkt.mean()
    denom = float((x**2).sum())
    if denom <= 0:
        return log_ret
    beta = log_ret.sub(log_ret.mean()).mul(x, axis=0).sum() / denom
    return log_ret - np.outer(mkt, beta)


def cluster_returns(closes_wide: pd.DataFrame, t: float = 0.55, min_members: int = 5, demarket: bool = True) -> list[dict]:
    """Cluster tickers (columns) by correlation of their trailing daily log returns.

    Takes the last `RETURN_WINDOW` rows of `closes_wide`, forward-fills gaps of
    at most 2 sessions, and drops any ticker still missing data. With
    `demarket` the equal-weight market return is regressed out first. Returns
    kept clusters (>= min_members) sorted by ret_63d descending; each dict has
    keys members, leaders, cluster_key, member_count, ret_63d.
    """
    window = closes_wide.tail(RETURN_WINDOW).copy()
    if window.shape[0] < 2:
        return []
    window = window.ffill(limit=2)
    valid_cols = [c for c in window.columns if window[c].notna().all()]
    window = window[valid_cols]
    if window.shape[1] < min_members:
        return []

    log_ret = np.log(window / window.shift(1)).iloc[1:]
    if log_ret.shape[0] < 2:
        return []
    basis = residual_returns(log_ret) if demarket and log_ret.shape[1] >= 5 else log_ret
    corr = basis.corr().astype(np.float32)

    dist = (1.0 - corr).clip(lower=0.0, upper=2.0)
    dist = (dist + dist.T) / 2.0  # guard against float asymmetry
    dist_values = dist.to_numpy(dtype=np.float64, copy=True)
    np.fill_diagonal(dist_values, 0.0)

    condensed = squareform(dist_values, checks=False)
    z = linkage(condensed, method="average")
    labels = fcluster(z, t=t, criterion="distance")

    total_ret = window.iloc[-1] / window.iloc[0] - 1.0  # simple return over the window

    groups: dict[int, list[str]] = {}
    for ticker, lab in zip(window.columns, labels):
        groups.setdefault(int(lab), []).append(ticker)

    out: list[dict] = []
    for members in groups.values():
        if len(members) < min_members:
            continue
        members_sorted = sorted(members, key=lambda tk: float(total_ret[tk]), reverse=True)
        leaders = members_sorted[:3]
        rets = [float(total_ret[m]) for m in members_sorted]
        out.append(
            {
                "members": members_sorted,
                "leaders": leaders,
                "cluster_key": "|".join(sorted(leaders)),
                "member_count": len(members_sorted),
                "ret_63d": float(np.median(rets)),
            }
        )

    out.sort(key=lambda d: d["ret_63d"], reverse=True)
    return out


def _write_empty(conn: psycopg.Connection) -> None:
    replace_table(conn, "research_clusters", CLUSTER_COLUMNS, [])
    replace_table(conn, "research_cluster_members", MEMBER_COLUMNS, [])


def run(conn: psycopg.Connection, ctx: JobContext) -> str:
    """Rebuild research_clusters / research_cluster_members as of ctx.scan_date."""
    scan_date = as_date(ctx.scan_date)
    universe_df = read_df(
        conn,
        UNIVERSE_SQL,
        {
            "since": (scan_date - timedelta(days=UNIVERSE_LOOKBACK_DAYS)).isoformat(),
            "until": scan_date.isoformat(),
            "exclude": sorted(EXCLUDE_TICKERS),
            "min_price": MIN_PRICE,
            "min_dv": MIN_DOLLAR_VOLUME,
            "min_hist": MIN_HISTORY_SESSIONS,
            "max_n": MAX_UNIVERSE,
        },
    )
    universe = universe_df["ticker"].tolist() if not universe_df.empty else []
    universe_n = len(universe)
    if universe_n < 5:
        _write_empty(conn)
        return f"0 clusters from {universe_n} names"

    bars = load_bars(
        conn,
        tickers=universe,
        since=(scan_date - timedelta(days=CLOSE_LOOKBACK_DAYS)).isoformat(),
        until=scan_date.isoformat(),
        columns=("c",),
    )
    if bars.empty:
        _write_empty(conn)
        return f"0 clusters from {universe_n} names"
    closes_wide = close_matrix(bars, "c").reindex(columns=universe)  # most liquid first, as before
    clusters = cluster_returns(closes_wide, t=0.55, min_members=5)

    cluster_rows = []
    member_rows = []
    for i, cl in enumerate(clusters, start=1):
        cluster_rows.append(
            (
                pyval(i),
                pyval(cl["cluster_key"]),
                list(cl["leaders"]),
                list(cl["members"]),
                pyval(cl["member_count"]),
                pyval(cl["ret_63d"]),
                pyval(scan_date),
            )
        )
        for m in cl["members"]:
            member_rows.append((pyval(m), pyval(i)))

    replace_table(conn, "research_clusters", CLUSTER_COLUMNS, cluster_rows)
    replace_table(conn, "research_cluster_members", MEMBER_COLUMNS, member_rows)
    # The snapshot accumulates (upsert on as_of, ticker), so a forced rerun of the same night is a no-op.
    write_rows(conn, "research_cluster_history", HISTORY_COLUMNS, history_rows(clusters, scan_date), conflict=["as_of", "ticker"])
    conn.commit()

    chained, left = chain_pending_nights(conn, ctx)
    note = f"{len(clusters)} clusters from {universe_n} names, {chained} night{'s' if chained != 1 else ''} chained to themes"
    return note + (f" ({left} left, resuming next run)" if left else "")


def _load_theme_state(conn: psycopg.Connection) -> tuple[dict[int, dict], dict[int, set[str]], list]:
    """Every theme row, the members of each live theme on its last night, and the
    THEME_GAP_NIGHTS most recent chained nights (ascending)."""
    themes: dict[int, dict] = {}
    tdf = read_df(conn, "SELECT theme_id, first_night, last_night, current_key, nights FROM research_themes")
    for r in tdf.itertuples(index=False):
        themes[int(r.theme_id)] = {"first_night": r.first_night, "last_night": r.last_night, "current_key": r.current_key, "nights": int(r.nights)}
    recent_df = read_df(
        conn,
        "SELECT DISTINCT as_of FROM research_cluster_history WHERE theme_id IS NOT NULL ORDER BY as_of DESC LIMIT %(n)s",
        {"n": THEME_GAP_NIGHTS},
    )
    recent = sorted(recent_df["as_of"].tolist()) if not recent_df.empty else []
    live = live_themes(themes, recent)
    members: dict[int, set[str]] = {tid: set() for tid in live}
    if live:
        mdf = read_df(
            conn,
            """SELECT ch.theme_id, ch.ticker FROM research_cluster_history ch
               JOIN research_themes t ON t.theme_id = ch.theme_id AND ch.as_of = t.last_night
               WHERE ch.theme_id = ANY(%(ids)s)""",
            {"ids": sorted(live)},
        )
        for r in mdf.itertuples(index=False):
            members[int(r.theme_id)].add(str(r.ticker))
    return themes, members, recent


def chain_pending_nights(conn: psycopg.Connection, ctx: JobContext) -> tuple[int, int]:
    """Give a theme_id to every night of research_cluster_history that has none,
    oldest first, carrying the theme state forward night by night. Returns
    (nights chained, nights left when the budget ran out)."""
    pending_df = read_df(conn, "SELECT DISTINCT as_of FROM research_cluster_history WHERE theme_id IS NULL ORDER BY as_of")
    pending = pending_df["as_of"].tolist() if not pending_df.empty else []
    if not pending:
        return 0, 0
    themes, members, recent = _load_theme_state(conn)
    next_id = max(themes, default=0) + 1
    done = 0
    for night in pending:
        if not ctx.has_time(20):
            break
        ndf = read_df(
            conn,
            """SELECT cluster_id, cluster_key, array_agg(ticker ORDER BY ticker) AS members
               FROM research_cluster_history WHERE as_of = %(d)s GROUP BY 1, 2 ORDER BY 1""",
            {"d": night},
        )
        live = live_themes(themes, recent)
        prev = {tid: members[tid] for tid in live if tid in members}
        sets = [set(map(str, m)) for m in ndf["members"]]
        ids = chain_clusters(prev, sets, next_id)
        next_id = max([next_id, *[i + 1 for i in ids]])
        touched: list[tuple] = []
        with conn.cursor() as cur:
            # One statement for the night's ids (a row trip per cluster made the back-fill minutes long).
            cur.execute(
                """UPDATE research_cluster_history ch SET theme_id = v.theme_id
                   FROM (SELECT unnest(%s::int[]) AS cluster_id, unnest(%s::int[]) AS theme_id) v
                   WHERE ch.as_of = %s AND ch.cluster_id = v.cluster_id""",
                ([int(c) for c in ndf["cluster_id"]], [int(t) for t in ids], night),
            )
            for r, tid, mem in zip(ndf.itertuples(index=False), ids, sets):
                t = themes.get(tid)
                if t is None:
                    t = themes[tid] = {"first_night": night, "last_night": night, "current_key": r.cluster_key, "nights": 0}
                t["last_night"], t["current_key"], t["nights"] = night, r.cluster_key, t["nights"] + 1
                members[tid] = mem
                touched.append((pyval(tid), pyval(t["first_night"]), pyval(night), pyval(r.cluster_key), pyval(t["nights"])))
            # Tonight's snapshot carries the id too, so the deck and the alias control can use it.
            cur.execute(
                """UPDATE research_clusters c SET theme_id = ch.theme_id FROM research_cluster_history ch
                   WHERE ch.as_of = c.as_of AND ch.cluster_id = c.cluster_id AND c.as_of = %s""",
                (night,),
            )
        write_rows(conn, "research_themes", THEME_COLUMNS, touched, conflict=["theme_id"])
        recent = (recent + [night])[-THEME_GAP_NIGHTS:]
        conn.commit()
        done += 1
    return done, len(pending) - done
