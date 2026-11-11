// Research layer readers + the trigger for the Python job (api/research_job.py).
// Everything here reads research_* / scan_history through getSql(); every reader
// returns an empty shape (never throws) so pages render before the first run.
import { CONFIG } from "./config";
import { getSql } from "./db";
import { EMPTY_POST_MORTEM, PM_RAN_R, PM_REASONS, type PostMortem } from "./post-mortem-read";
import { galleryRowFromSql, pickGallery, type GalleryRow, type GalleryRowSql } from "./gallery";
import {
  type ChangeScore,
  type Metrics,
  type PeriodSums,
  RULE_CHANGES,
  type RuleChange,
  ZERO_SUMS,
  addSums,
  firstReadDate,
  lastChangeDate,
  lensFromMetrics,
  lensFromTrades,
  metrics,
  scoreChange,
  scorecardSentence,
} from "./research-story";

/* ---------- trigger ---------- */

export interface ResearchRunResult {
  scan_date?: string;
  seconds?: number;
  error?: string;
  skipped?: string;
  results: { job: string; status: "ok" | "current" | "deferred" | "error"; note?: string; seconds: number }[];
}

/** Where the Python function lives: same deployment in production, RESEARCH_URL override for dev. */
export function researchUrl(): string | null {
  if (process.env.RESEARCH_URL) return process.env.RESEARCH_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}/api/research_job` : null;
}

/** Call the Python job. Never throws: an unreachable function is reported in the result. */
export async function triggerResearch(opts: { force?: boolean; jobs?: string[]; budget?: number } = {}): Promise<ResearchRunResult> {
  const url = researchUrl();
  if (!url) return { skipped: "RESEARCH_URL / VERCEL_URL not set (local dev)", results: [] };
  const q = new URLSearchParams();
  if (opts.force) q.set("force", "1");
  if (opts.jobs?.length) q.set("job", opts.jobs.join(","));
  if (opts.budget) q.set("budget", String(opts.budget));
  const headers: Record<string, string> = {};
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  try {
    const res = await fetch(`${url}?${q}`, { method: "POST", headers, signal: AbortSignal.timeout(290_000), cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Partial<ResearchRunResult>;
    if (!res.ok) return { error: body.error ?? `research job returned ${res.status}`, results: body.results ?? [] };
    return { results: [], ...body };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), results: [] };
  }
}

/* ---------- readers ---------- */

export interface Group {
  key: string;
  label: string;
  n: number; // rows with a known 10-session outcome
  hitRate: number | null;
  avgR: number | null;
}
export interface FrameworkRow {
  framework: string;
  label: string;
  hitObjected: number | null;
  nObjected: number;
  hitOther: number | null;
  nOther: number;
}
export interface RunRow {
  job: string;
  scanDate: string | null;
  ok: boolean | null;
  finishedAt: string | null;
  note: string | null;
}
export interface ResearchSummary {
  scans: number;
  deckRows: number;
  labelled: number;
  firstDate: string | null;
  lastDate: string | null;
  byVerdict: Group[];
  byBadge: Group[];
  byFramework: FrameworkRow[];
  runs: RunRow[];
}

const FRAMEWORKS: [string, string][] = [
  ["livermore", "Livermore · chasing / pivot"],
  ["qullamaggie", "Kullamägi · rest, spike, market"],
  ["darvas", "Darvas · box risk"],
  ["minervini", "Minervini · VCP"],
];

const EMPTY: ResearchSummary = { scans: 0, deckRows: 0, labelled: 0, firstDate: null, lastDate: null, byVerdict: [], byBadge: [], byFramework: [], runs: [] };

type Agg = { n: number; hit: number | null; avg_r: number | null };
const grp = (key: string, label: string, a: Agg | undefined): Group => ({
  key,
  label,
  n: Number(a?.n ?? 0),
  hitRate: a?.hit === null || a?.hit === undefined ? null : Number(a.hit),
  avgR: a?.avg_r === null || a?.avg_r === undefined ? null : Number(a.avg_r),
});

/** Deck-level hit rates. "Deck" = scan_history rows with a rank (the capped nightly deck). */
export async function getResearchSummary(): Promise<ResearchSummary> {
  const sql = getSql();
  try {
    const [tot] = (await sql`
      SELECT count(DISTINCT h.date)::int AS scans, count(*)::int AS deck_rows,
             count(o.broke_10d)::int AS labelled, min(h.date)::text AS first_date, max(h.date)::text AS last_date
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker) WHERE h.rank IS NOT NULL
    `) as { scans: number; deck_rows: number; labelled: number; first_date: string | null; last_date: string | null }[];
    const byVerdictRows = (await sql`
      SELECT h.verdict AS key, count(o.broke_10d)::int AS n, avg(o.broke_10d::int) AS hit, avg(o.r_at_exit) AS avg_r
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker) WHERE h.rank IS NOT NULL GROUP BY h.verdict
    `) as ({ key: string } & Agg)[];
    const badgeRows = (await sql`
      SELECT CASE WHEN h.boxed THEN 'boxed' ELSE 'nobox' END AS key, count(o.broke_10d)::int AS n, avg(o.broke_10d::int) AS hit, avg(o.r_at_exit) AS avg_r
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker) WHERE h.rank IS NOT NULL GROUP BY h.boxed
      UNION ALL
      SELECT 'ep', count(o.broke_10d)::int, avg(o.broke_10d::int), avg(o.r_at_exit)
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker) WHERE h.rank IS NOT NULL AND h.ep
      UNION ALL
      SELECT 'vcp', count(o.broke_10d)::int, avg(o.broke_10d::int), avg(o.r_at_exit)
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker) WHERE h.rank IS NOT NULL AND h.vcp
      UNION ALL
      SELECT 'boxed_wait', count(o.broke_10d)::int, avg(o.broke_10d::int), avg(o.r_at_exit)
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker) WHERE h.rank IS NOT NULL AND h.boxed AND h.verdict = 'wait'
    `) as ({ key: string } & Agg)[];
    const fwRows = (await sql`
      SELECT f.name AS framework, (f.name = ANY(h.objections)) AS objected,
             count(o.broke_10d)::int AS n, avg(o.broke_10d::int) AS hit
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker),
           unnest(ARRAY['qullamaggie','livermore','darvas','minervini']) AS f(name)
      WHERE h.rank IS NOT NULL GROUP BY f.name, objected
    `) as { framework: string; objected: boolean; n: number; hit: number | null }[];
    const runs = (await sql`
      SELECT job, scan_date::text AS scan_date, ok, finished_at::text AS finished_at, note FROM research_runs ORDER BY job
    `) as { job: string; scan_date: string | null; ok: boolean | null; finished_at: string | null; note: string | null }[];

    const byV = new Map(byVerdictRows.map((r) => [r.key, r]));
    const byB = new Map(badgeRows.map((r) => [r.key, r]));
    return {
      scans: tot.scans,
      deckRows: tot.deck_rows,
      labelled: tot.labelled,
      firstDate: tot.first_date,
      lastDate: tot.last_date,
      byVerdict: [grp("wait", "Wait", byV.get("wait")), grp("pass", "Pass", byV.get("pass"))],
      byBadge: [
        grp("boxed", "Boxed", byB.get("boxed")),
        grp("nobox", "No box", byB.get("nobox")),
        grp("boxed_wait", "Boxed + Wait", byB.get("boxed_wait")),
        grp("ep", "EP badge", byB.get("ep")),
        grp("vcp", "VCP", byB.get("vcp")),
      ],
      byFramework: FRAMEWORKS.map(([framework, label]) => {
        const yes = fwRows.find((r) => r.framework === framework && r.objected);
        const no = fwRows.find((r) => r.framework === framework && !r.objected);
        return {
          framework,
          label,
          hitObjected: yes?.hit == null ? null : Number(yes.hit),
          nObjected: Number(yes?.n ?? 0),
          hitOther: no?.hit == null ? null : Number(no.hit),
          nOther: Number(no?.n ?? 0),
        };
      }),
      runs: runs.map((r) => ({ job: r.job, scanDate: r.scan_date, ok: r.ok, finishedAt: r.finished_at, note: r.note })),
    };
  } catch {
    return EMPTY;
  }
}

export interface SweepPoint {
  param: string;
  value: number;
  deckSize: number;
  hitRate: number | null;
  avgR: number | null;
  /** Spread behind avgR (1.7.9), for the exit grid's bands; null on the threshold curves. */
  sdR: number | null;
  n: number;
  isCurrent: boolean;
}
/** Every sweep row: the four threshold curves and, since 1.7.9, the EXIT_* params of the exit grid (lib/exit-read.ts reads those). */
export async function getSweep(): Promise<SweepPoint[]> {
  try {
    const rows = (await getSql()`SELECT param, value, deck_size, hit_rate, avg_r, sd_r, n, is_current FROM research_sweep ORDER BY param, value`) as {
      param: string; value: number; deck_size: number; hit_rate: number | null; avg_r: number | null; sd_r: number | null; n: number; is_current: boolean;
    }[];
    return rows.map((r) => ({ param: r.param, value: Number(r.value), deckSize: Number(r.deck_size), hitRate: r.hit_rate === null ? null : Number(r.hit_rate), avgR: r.avg_r === null ? null : Number(r.avg_r), sdR: r.sd_r === null ? null : Number(r.sd_r), n: r.n, isCurrent: r.is_current }));
  } catch {
    return [];
  }
}

export interface Cluster {
  clusterId: number;
  clusterKey: string;
  /** Stable theme id (1.7.8); null until the clusters job has chained tonight. */
  themeId: number | null;
  alias: string | null;
  leaders: string[];
  members: string[];
  memberCount: number;
  ret63d: number;
  inDeck: string[]; // members that are in tonight's deck
  asOf: string;
}
/** Every cluster, with the deck names it contains; strongest first. */
export async function getClusters(deckTickers: string[]): Promise<Cluster[]> {
  try {
    // The alias by theme id wins (it survives a change of leaders); the key-only alias is the pre-1.7.8 fallback.
    const rows = (await getSql()`
      SELECT c.cluster_id, c.cluster_key, c.theme_id,
             COALESCE((SELECT alias FROM research_cluster_alias t WHERE t.theme_id = c.theme_id ORDER BY t.updated_at DESC LIMIT 1), a.alias) AS alias,
             c.leaders, c.members, c.member_count, c.ret_63d, c.as_of::text AS as_of
      FROM research_clusters c LEFT JOIN research_cluster_alias a USING (cluster_key) ORDER BY c.cluster_id
    `) as { cluster_id: number; cluster_key: string; theme_id: number | null; alias: string | null; leaders: string[]; members: string[]; member_count: number; ret_63d: number; as_of: string }[];
    const deck = new Set(deckTickers);
    return rows.map((r) => ({
      clusterId: r.cluster_id,
      clusterKey: r.cluster_key,
      themeId: r.theme_id === null ? null : Number(r.theme_id),
      alias: r.alias,
      leaders: r.leaders,
      members: r.members,
      memberCount: r.member_count,
      ret63d: Number(r.ret_63d),
      inDeck: r.members.filter((m) => deck.has(m)),
      asOf: r.as_of,
    }));
  } catch {
    return [];
  }
}

/** Name a theme. The row is keyed by tonight's cluster key and carries the theme id (1.7.8), so readers find it by either. */
export async function setClusterAlias(clusterKey: string, alias: string, themeId: number | null = null): Promise<void> {
  const sql = getSql();
  if (alias.trim() === "") {
    await sql`DELETE FROM research_cluster_alias WHERE cluster_key = ${clusterKey} OR (${themeId}::int IS NOT NULL AND theme_id = ${themeId})`;
    return;
  }
  await sql`
    INSERT INTO research_cluster_alias (cluster_key, alias, theme_id) VALUES (${clusterKey}, ${alias.trim().slice(0, 40)}, ${themeId})
    ON CONFLICT (cluster_key) DO UPDATE SET alias = EXCLUDED.alias, theme_id = COALESCE(EXCLUDED.theme_id, research_cluster_alias.theme_id), updated_at = now()
  `;
}

export interface SplitRow {
  ticker: string;
  date: string;
  ratio: number;
  gapPct: number;
  volRatio: number | null;
  confidence: number;
  status: "auto" | "review" | "ignored";
  factor: number;
}
export async function getSplits(limit = 60): Promise<SplitRow[]> {
  try {
    const rows = (await getSql()`
      SELECT ticker, date::text AS date, ratio, gap_pct, vol_ratio, confidence, status, factor FROM research_splits
      ORDER BY (status = 'review') DESC, date DESC LIMIT ${limit}
    `) as { ticker: string; date: string; ratio: number; gap_pct: number; vol_ratio: number | null; confidence: number; status: SplitRow["status"]; factor: number }[];
    return rows.map((r) => ({ ticker: r.ticker, date: r.date, ratio: Number(r.ratio), gapPct: Number(r.gap_pct), volRatio: r.vol_ratio === null ? null : Number(r.vol_ratio), confidence: Number(r.confidence), status: r.status, factor: Number(r.factor) }));
  } catch {
    return [];
  }
}
export async function setSplitStatus(ticker: string, date: string, status: SplitRow["status"]): Promise<void> {
  await getSql()`UPDATE research_splits SET status = ${status}, updated_at = now() WHERE ticker = ${ticker} AND date = ${date}`;
}

export interface BreadthRow {
  date: string;
  universe: number;
  pctAbove20: number;
  pctAbove50: number | null;
  pct10Over20: number;
  newHighs: number;
  newLows: number;
  marketBullish: boolean | null; // the index verdict of that night's scan, when known
}
export interface BreadthBucket {
  label: string;
  n: number;
  hitRate: number | null;
}
export async function getBreadth(days = 120): Promise<{ rows: BreadthRow[]; buckets: BreadthBucket[] }> {
  try {
    const sql = getSql();
    const rows = (await sql`
      SELECT b.date::text AS date, b.universe, b.pct_above_20, b.pct_above_50, b.pct_10_over_20, b.new_highs, b.new_lows,
             (SELECT bool_or(market_bullish) FROM scan_history h WHERE h.date = b.date) AS market_bullish
      FROM research_breadth b ORDER BY b.date DESC LIMIT ${days}
    `) as { date: string; universe: number; pct_above_20: number; pct_above_50: number | null; pct_10_over_20: number; new_highs: number; new_lows: number; market_bullish: boolean | null }[];
    const bucketRows = (await sql`
      SELECT CASE WHEN b.pct_above_20 < 0.35 THEN 'lt35' WHEN b.pct_above_20 < 0.5 THEN '35_50' WHEN b.pct_above_20 < 0.65 THEN '50_65' ELSE 'gt65' END AS bucket,
             count(o.broke_10d)::int AS n, avg(o.broke_10d::int) AS hit
      FROM scan_history h JOIN research_breadth b USING (date) LEFT JOIN research_outcomes o USING (date, ticker)
      WHERE h.rank IS NOT NULL GROUP BY 1
    `) as { bucket: string; n: number; hit: number | null }[];
    const by = new Map(bucketRows.map((r) => [r.bucket, r]));
    const bucket = (key: string, label: string): BreadthBucket => ({ label, n: Number(by.get(key)?.n ?? 0), hitRate: by.get(key)?.hit == null ? null : Number(by.get(key)!.hit) });
    return {
      rows: rows.reverse().map((r) => ({ date: r.date, universe: r.universe, pctAbove20: Number(r.pct_above_20), pctAbove50: r.pct_above_50 === null ? null : Number(r.pct_above_50), pct10Over20: Number(r.pct_10_over_20), newHighs: r.new_highs, newLows: r.new_lows, marketBullish: r.market_bullish })),
      buckets: [bucket("lt35", "<35%"), bucket("35_50", "35–50%"), bucket("50_65", "50–65%"), bucket("gt65", ">65%")],
    };
  } catch {
    return { rows: [], buckets: [] };
  }
}
/** The last two breadth rows (today and the session before), for the market strip. */
export interface ThemeBucket {
  key: "none" | "alone" | "few" | "many";
  label: string;
  n: number;
  hitRate: number | null;
  avgKR: number | null;
  sdKR: number | null;
  kN: number;
}
export interface ThemeRow {
  /** Stable theme id (1.7.8); the row is one theme across every key it held. */
  themeId: number;
  /** The theme's latest key (its leaders on the last night it was seen). */
  clusterKey: string;
  alias: string | null;
  leaders: string[];
  /** Nights the theme was seen, first to last. */
  nights: number;
  /** The theme's nightly rank as a share of the night's clusters (1 = strongest), oldest first. */
  strength: number[];
  n: number;
  hitRate: number | null;
  avgKR: number | null;
  sdKR: number | null;
  kN: number;
  first: string;
  last: string;
  /** The theme is on tonight's snapshot. */
  current: boolean;
}
export interface ThemeStudy {
  /** First night with saved membership; null before the clusters job has run. */
  since: string | null;
  nights: number;
  /** Deck rows since then, and how many of them sat in a theme that night. */
  deckRows: number;
  inTheme: number;
  byMates: ThemeBucket[];
  themes: ThemeRow[];
}

const MATES_LABEL: Record<ThemeBucket["key"], string> = {
  none: "In no theme that night",
  alone: "Alone in its theme",
  few: "2–3 deck-mates",
  many: "4+ deck-mates",
};

/**
 * Themes, scored (1.7.4): every deck row since membership began saving nightly
 * (research_cluster_history, 2026-09-21), joined to the theme it sat in that
 * night. Two reads — by how many other deck names shared the theme (his
 * "leaders move in groups"), and per theme by its stable id (1.7.8: one row
 * per theme across every key it held, with its lifespan and nightly rank;
 * rows the job has not chained yet fall back to their key). Empty on any error.
 */
export async function getThemeStudy(limit = 12): Promise<ThemeStudy> {
  const empty: ThemeStudy = { since: null, nights: 0, deckRows: 0, inTheme: 0, byMates: [], themes: [] };
  try {
    const sql = getSql();
    const [cov] = (await sql`
      SELECT min(as_of)::text AS since, count(DISTINCT as_of)::int AS nights FROM research_cluster_history
    `) as { since: string | null; nights: number }[];
    if (!cov?.since) return empty;
    const mates = (await sql`
      WITH d AS (
        SELECT h.date, h.ticker, ch.cluster_key, o.broke_10d, o.k_r
        FROM scan_history h
        LEFT JOIN research_cluster_history ch ON ch.as_of = h.date AND ch.ticker = h.ticker
        LEFT JOIN research_outcomes o ON o.date = h.date AND o.ticker = h.ticker
        WHERE h.rank IS NOT NULL AND h.date >= ${cov.since}::date
      ),
      m AS (SELECT date, cluster_key, count(*) AS n FROM d WHERE cluster_key IS NOT NULL GROUP BY 1, 2)
      SELECT CASE WHEN d.cluster_key IS NULL THEN 'none' WHEN m.n = 1 THEN 'alone' WHEN m.n <= 3 THEN 'few' ELSE 'many' END AS key,
             count(*)::int AS rows, count(d.broke_10d)::int AS n, avg(d.broke_10d::int) AS hit, avg(d.k_r) AS avg_k_r, stddev_samp(d.k_r) AS sd_k_r, count(d.k_r)::int AS k_n
      FROM d LEFT JOIN m ON m.date = d.date AND m.cluster_key = d.cluster_key
      GROUP BY 1
    `) as { key: ThemeBucket["key"]; rows: number; n: number; hit: number | null; avg_k_r: number | null; sd_k_r: number | null; k_n: number }[];
    const themes = (await sql`
      WITH g AS (
        SELECT COALESCE(ch.theme_id, -dense_rank() OVER (ORDER BY ch.cluster_key)::int) AS theme_id, ch.cluster_key, h.date, o.broke_10d, o.k_r
        FROM scan_history h
        JOIN research_cluster_history ch ON ch.as_of = h.date AND ch.ticker = h.ticker
        LEFT JOIN research_outcomes o ON o.date = h.date AND o.ticker = h.ticker
        WHERE h.rank IS NOT NULL
      ),
      d AS (SELECT DISTINCT theme_id, as_of, cluster_id FROM research_cluster_history WHERE theme_id IS NOT NULL),
      rank AS (SELECT theme_id, as_of, (cluster_id - 1)::float / greatest(1, count(*) OVER (PARTITION BY as_of) - 1) AS pos FROM d),
      s AS (SELECT theme_id, array_agg(pos ORDER BY as_of) AS strength FROM rank GROUP BY 1)
      SELECT g.theme_id, COALESCE(t.current_key, max(g.cluster_key)) AS cluster_key,
             COALESCE((SELECT alias FROM research_cluster_alias x WHERE x.theme_id = g.theme_id ORDER BY x.updated_at DESC LIMIT 1),
                      (SELECT alias FROM research_cluster_alias x WHERE x.cluster_key = COALESCE(t.current_key, max(g.cluster_key)))) AS alias,
             COALESCE(t.nights, count(DISTINCT g.date))::int AS nights, count(g.broke_10d)::int AS n,
             avg(g.broke_10d::int) AS hit, avg(g.k_r) AS avg_k_r, stddev_samp(g.k_r) AS sd_k_r, count(g.k_r)::int AS k_n,
             COALESCE(t.first_night, min(g.date))::text AS first, COALESCE(t.last_night, max(g.date))::text AS last,
             EXISTS (SELECT 1 FROM research_clusters c WHERE c.theme_id = g.theme_id OR (g.theme_id < 0 AND c.cluster_key = max(g.cluster_key))) AS current,
             COALESCE(s.strength, '{}') AS strength
      FROM g
      LEFT JOIN research_themes t ON t.theme_id = g.theme_id
      LEFT JOIN s ON s.theme_id = g.theme_id
      GROUP BY g.theme_id, t.theme_id, t.current_key, t.nights, t.first_night, t.last_night, s.strength
      HAVING count(g.broke_10d) >= 8
      ORDER BY n DESC, nights DESC
      LIMIT ${limit}
    `) as { theme_id: number; cluster_key: string; alias: string | null; nights: number; n: number; hit: number | null; avg_k_r: number | null; sd_k_r: number | null; k_n: number; first: string; last: string; current: boolean; strength: number[] }[];
    const by = new Map(mates.map((r) => [r.key, r]));
    const num = (x: number | null) => (x === null ? null : Number(x));
    return {
      since: cov.since,
      nights: cov.nights,
      deckRows: mates.reduce((s, r) => s + r.rows, 0),
      inTheme: mates.filter((r) => r.key !== "none").reduce((s, r) => s + r.rows, 0),
      byMates: (["none", "alone", "few", "many"] as const).map((key) => {
        const r = by.get(key);
        return { key, label: MATES_LABEL[key], n: r?.n ?? 0, hitRate: num(r?.hit ?? null), avgKR: num(r?.avg_k_r ?? null), sdKR: num(r?.sd_k_r ?? null), kN: r?.k_n ?? 0 };
      }),
      themes: themes.map((r) => ({
        themeId: Number(r.theme_id), clusterKey: r.cluster_key, alias: r.alias, leaders: r.cluster_key.split("|"), nights: Number(r.nights), n: r.n,
        strength: (r.strength ?? []).map(Number),
        hitRate: num(r.hit), avgKR: num(r.avg_k_r), sdKR: num(r.sd_k_r), kN: r.k_n, first: r.first, last: r.last, current: r.current,
      })),
    };
  } catch {
    return empty;
  }
}

export interface TapeVerdictRow {
  bullish: boolean | null;
  n: number;
  hitRate: number | null;
  /** Avg R of the Auto book's plan (k_r) on the boxed Wait rows scanned under that verdict. */
  avgKR: number | null;
  sdKR: number | null;
  kN: number;
}

/**
 * The deck by the index verdict on scan night (/tape, 1.7.0): how many deck
 * rows each verdict produced, their 10-session breakout rate, and the Auto
 * plan's avg R on the boxed Wait rows among them. Empty on any error.
 */
export async function getTapeStudy(): Promise<TapeVerdictRow[]> {
  try {
    const rows = (await getSql()`
      SELECT h.market_bullish AS bullish, count(o.broke_10d)::int AS n, avg(o.broke_10d::int) AS hit,
             avg(o.k_r) AS avg_k_r, stddev_samp(o.k_r) AS sd_k_r, count(o.k_r)::int AS k_n
      FROM scan_history h JOIN research_outcomes o USING (date, ticker)
      WHERE h.rank IS NOT NULL
      GROUP BY 1 ORDER BY 1 DESC NULLS LAST
    `) as { bullish: boolean | null; n: number; hit: number | null; avg_k_r: number | null; sd_k_r: number | null; k_n: number }[];
    return rows.map((r) => ({
      bullish: r.bullish, n: r.n, hitRate: r.hit === null ? null : Number(r.hit),
      avgKR: r.avg_k_r === null ? null : Number(r.avg_k_r), sdKR: r.sd_k_r === null ? null : Number(r.sd_k_r), kN: r.k_n,
    }));
  } catch {
    return [];
  }
}

export async function latestBreadth(): Promise<{ today: BreadthRow; prev: BreadthRow | null } | null> {
  const { rows } = await getBreadth(2);
  if (rows.length === 0) return null;
  return { today: rows[rows.length - 1], prev: rows.length > 1 ? rows[0] : null };
}

export interface ReplayRow {
  track: "auto" | "manual";
  rule: string;
  label: string;
  avgR: number | null;
  winRate: number | null;
  maxDd: number | null;
  avgHold: number | null;
  totalPnl: number | null;
  trades: number;
  isCurrent: boolean;
  asOf: string;
}
export async function getReplay(): Promise<ReplayRow[]> {
  try {
    const rows = (await getSql()`SELECT track, rule, label, avg_r, win_rate, max_dd, avg_hold, total_pnl, trades, is_current, as_of::text AS as_of FROM research_replay ORDER BY track, avg_r DESC NULLS LAST`) as {
      track: ReplayRow["track"]; rule: string; label: string; avg_r: number | null; win_rate: number | null; max_dd: number | null; avg_hold: number | null; total_pnl: number | null; trades: number; is_current: boolean; as_of: string;
    }[];
    const num = (x: number | null) => (x === null ? null : Number(x));
    return rows.map((r) => ({ track: r.track, rule: r.rule, label: r.label, avgR: num(r.avg_r), winRate: num(r.win_rate), maxDd: num(r.max_dd), avgHold: num(r.avg_hold), totalPnl: num(r.total_pnl), trades: r.trades, isCurrent: r.is_current, asOf: r.as_of }));
  } catch {
    return [];
  }
}

/* ---------- episodic-pivot study (research/ep.py) ---------- */

/** A name is "neglected" before its gap when its 3-month return was under this — the screen's own 1-month momentum floor. */
export const EP_NEGLECT_RET_3M = CONFIG.MOMENTUM.M1;
/** Volume-multiple buckets the page splits on; the job stores every multiple from CONFIG.EP.VOL_MULT up. */
export const EP_VOL_BUCKETS = [CONFIG.EP.VOL_MULT, 5, 10] as const;

export interface EpGroup {
  key: string;
  label: string;
  n: number; // rows with a known R
  winRate: number | null;
  avgR: number | null;
  avgMfe20: number | null; // mean best close over the 20 sessions after entry, against the entry
}
export interface EpRecent {
  date: string;
  ticker: string;
  gapPct: number;
  volMult: number | null;
  ret3mBefore: number | null;
  heldGap: boolean;
  taken: boolean | null;
  r: number | null;
}
export interface EpStudy {
  candidates: number;
  taken: number;
  labelled: number;
  firstDate: string | null;
  lastDate: string | null;
  overall: EpGroup;
  byNeglect: EpGroup[];
  byVolume: EpGroup[];
  byHeld: EpGroup[];
  byBoth: EpGroup[]; // the interview's own description: neglected and the volume surge together
  recent: EpRecent[];
}

const EP_EMPTY: EpStudy = {
  candidates: 0, taken: 0, labelled: 0, firstDate: null, lastDate: null,
  overall: { key: "all", label: "All", n: 0, winRate: null, avgR: null, avgMfe20: null },
  byNeglect: [], byVolume: [], byHeld: [], byBoth: [], recent: [],
};

type EpAgg = { key: string; n: number; win: number | null; avg_r: number | null; mfe: number | null };
const epGrp = (key: string, label: string, a: EpAgg | undefined): EpGroup => ({
  key,
  label,
  n: Number(a?.n ?? 0),
  winRate: a?.win == null ? null : Number(a.win),
  avgR: a?.avg_r == null ? null : Number(a.avg_r),
  avgMfe20: a?.mfe == null ? null : Number(a.mfe),
});

/**
 * Kullamägi's episodic pivot, as the stored history would have traded it at the
 * next open with the stop at the gap day's low: how often it paid, split by how
 * neglected the name was before the gap, by the volume multiple, and by whether
 * the gap day closed above its open. Reads research_ep only. Never throws.
 */
/* ---------- Kullamägi's plan on every boxed Wait card (research/outcomes.py k_* / bs_*) ---------- */

export interface PlanGroup {
  key: string;
  label: string;
  n: number;
  winRate: number | null;
  avgR: number | null;
  /** Sample sd of R, for the average's range (1.7.6). */
  sdR: number | null;
  /** Share of eligible rows the entry filled (entry table only). */
  filled: number | null;
}
export interface KullamagiStudy {
  /** Boxed Wait deck rows that closed under their box top on scan night — the rows the Auto book could arm. */
  rows: number;
  byWidth: PlanGroup[];
  byAdr: PlanGroup[];
  byEntry: PlanGroup[];
}

const PLAN_LABELS: Record<string, string> = {
  w1: "≤ ½ ADR", w2: "½–1 ADR", w3: "1–1½ ADR", w4: "> 1½ ADR",
  a1: "ADR 3.5–5%", a2: "ADR 5–7%", a3: "ADR 7%+",
  next_open: "Next open after the first close above the box, stop at that day's low (the Auto book)",
  buy_stop: "Resting buy-stop at the box top, stop one ADR under the fill",
};
const PLAN_ORDER: Record<"width" | "adr" | "entry", string[]> = {
  width: ["w1", "w2", "w3", "w4"],
  adr: ["a1", "a2", "a3"],
  entry: ["next_open", "buy_stop"],
};

/**
 * The plan the Auto book trades, and the resting buy-stop, scored on every boxed
 * Wait card in the deck history: by the next-open stop's width in ADR units, by
 * the card's ADR, and entry against entry. The width table decides whether the
 * book should skip wide stops; the entry table which entry it keeps.
 */
export async function getKullamagiStudy(): Promise<KullamagiStudy> {
  const empty: KullamagiStudy = { rows: 0, byWidth: [], byAdr: [], byEntry: [] };
  try {
    const sql = getSql();
    const rows = (await sql`
      WITH b AS (
        SELECT o.k_r, o.k_stop_adr, o.k_entry_day, o.bs_r, o.bs_entry_day, h.adr_pct
        FROM scan_history h JOIN research_outcomes o USING (date, ticker)
        WHERE h.rank IS NOT NULL AND h.boxed AND h.verdict = 'wait' AND h.box_top IS NOT NULL AND h.close <= h.box_top
      )
      SELECT 'width' AS dim,
             CASE WHEN k_stop_adr <= 0.5 THEN 'w1' WHEN k_stop_adr <= 1 THEN 'w2' WHEN k_stop_adr <= 1.5 THEN 'w3' ELSE 'w4' END AS key,
             count(k_r)::int AS n, avg((k_r > 0)::int) FILTER (WHERE k_r IS NOT NULL) AS win, avg(k_r) AS avg_r, stddev_samp(k_r) AS sd_r,
             NULL::double precision AS filled, (SELECT count(*) FROM b)::int AS total
      FROM b WHERE k_stop_adr IS NOT NULL GROUP BY 2
      UNION ALL
      SELECT 'adr', CASE WHEN adr_pct < 5 THEN 'a1' WHEN adr_pct < 7 THEN 'a2' ELSE 'a3' END,
             count(k_r)::int, avg((k_r > 0)::int) FILTER (WHERE k_r IS NOT NULL), avg(k_r), stddev_samp(k_r), NULL, (SELECT count(*) FROM b)::int
      FROM b WHERE adr_pct IS NOT NULL GROUP BY 2
      UNION ALL
      SELECT 'entry', 'next_open', count(k_r)::int, avg((k_r > 0)::int) FILTER (WHERE k_r IS NOT NULL), avg(k_r), stddev_samp(k_r),
             avg((k_entry_day IS NOT NULL)::int), (SELECT count(*) FROM b)::int FROM b
      UNION ALL
      SELECT 'entry', 'buy_stop', count(bs_r)::int, avg((bs_r > 0)::int) FILTER (WHERE bs_r IS NOT NULL), avg(bs_r), stddev_samp(bs_r),
             avg((bs_entry_day IS NOT NULL)::int), (SELECT count(*) FROM b)::int FROM b
    `) as { dim: "width" | "adr" | "entry"; key: string; n: number; win: number | null; avg_r: number | null; sd_r: number | null; filled: number | null; total: number }[];
    const by = new Map(rows.map((r) => [`${r.dim}:${r.key}`, r]));
    const group = (dim: keyof typeof PLAN_ORDER): PlanGroup[] =>
      PLAN_ORDER[dim].map((key) => {
        const r = by.get(`${dim}:${key}`);
        return {
          key,
          label: PLAN_LABELS[key],
          n: Number(r?.n ?? 0),
          winRate: r?.win == null ? null : Number(r.win),
          avgR: r?.avg_r == null ? null : Number(r.avg_r),
          sdR: r?.sd_r == null ? null : Number(r.sd_r),
          filled: r?.filled == null ? null : Number(r.filled),
        };
      });
    return { rows: Number(rows[0]?.total ?? 0), byWidth: group("width"), byAdr: group("adr"), byEntry: group("entry") };
  } catch (err) {
    console.error("getKullamagiStudy failed:", err);
    return empty;
  }
}

/* ---------- the drawdown fan (1.8.0, R5 of the Python-studies plan) ---------- */

export interface FanRow {
  trades: number;
  q05: number;
  q25: number;
  q50: number;
  q75: number;
  q95: number;
}
export interface Fan {
  rows: FanRow[];
  /** The Auto book's trade count the job scored, and the share of chance sequences under its cumulative R. Null before the book has a closed trade. */
  bookTrades: number | null;
  bookPct: number | null;
  asOf: string | null;
}

/** The chance bands of the plan's history (research_mc, written by research/mc.py). Empty before the first run. */
export async function getFan(): Promise<Fan> {
  try {
    const rows = (await getSql()`SELECT trades, q05, q25, q50, q75, q95, book_pct, as_of::text AS as_of FROM research_mc ORDER BY trades`) as {
      trades: number; q05: number; q25: number; q50: number; q75: number; q95: number; book_pct: number | null; as_of: string;
    }[];
    const scored = rows.find((r) => r.book_pct !== null);
    return {
      rows: rows.map((r) => ({ trades: r.trades, q05: Number(r.q05), q25: Number(r.q25), q50: Number(r.q50), q75: Number(r.q75), q95: Number(r.q95) })),
      bookTrades: scored ? scored.trades : null,
      bookPct: scored ? Number(scored.book_pct) : null,
      asOf: rows[0]?.as_of ?? null,
    };
  } catch {
    return { rows: [], bookTrades: null, bookPct: null, asOf: null };
  }
}

/* ---------- the stop post-mortem (1.8.9) ---------- */

/**
 * The plan's trades taken apart (research_outcomes.post_mortem, written by the
 * outcomes job), on the trades the Auto book would buy: a stop no wider than
 * MAX_STOP_ADR. Empty before the first run. lib/post-mortem-read.ts reads it.
 */
export async function getPostMortem(): Promise<PostMortem> {
  try {
    const sql = getSql();
    const maxAdr = CONFIG.PAPER.KULLAMAGI.MAX_STOP_ADR;
    const num = (x: number | null) => (x === null ? null : Number(x));
    const [reasons, rest] = await Promise.all([
      sql`
        SELECT post_mortem[1]::int AS reason, count(*)::int AS n, avg(post_mortem[4]) AS avg_r,
               count(*) FILTER (WHERE post_mortem[8] >= ${PM_RAN_R})::int AS ran_after,
               count(*) FILTER (WHERE post_mortem[2] = 1)::int AS day1,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY post_mortem[2]) AS med_exit_day
        FROM research_outcomes WHERE post_mortem IS NOT NULL AND k_stop_adr <= ${maxAdr}
        GROUP BY 1 ORDER BY 1`,
      sql`
        SELECT count(*) FILTER (WHERE post_mortem[4] > 0)::int AS win_n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY post_mortem[5]) FILTER (WHERE post_mortem[4] > 0) AS win_med_mae,
               count(*) FILTER (WHERE post_mortem[4] > 0 AND post_mortem[5] <= -0.5)::int AS win_deep,
               count(*) FILTER (WHERE post_mortem[6] >= 1)::int AS off_n,
               COALESCE(sum(post_mortem[4]) FILTER (WHERE post_mortem[6] >= 1), 0) AS off_r,
               COALESCE(sum(post_mortem[6]) FILTER (WHERE post_mortem[6] >= 1), 0) AS off_peak,
               count(*) FILTER (WHERE post_mortem[6] >= 1 AND post_mortem[4] < 0.5 * post_mortem[6])::int AS off_gave_back
        FROM research_outcomes WHERE post_mortem IS NOT NULL AND k_stop_adr <= ${maxAdr}`,
    ]);
    const r0 = (rest as Record<string, number | null>[])[0] ?? {};
    return {
      reasons: (reasons as { reason: number; n: number; avg_r: number | null; ran_after: number; day1: number; med_exit_day: number | null }[])
        .filter((r) => PM_REASONS[r.reason] !== undefined)
        .map((r) => ({ reason: PM_REASONS[r.reason], n: r.n, avgR: num(r.avg_r), ranAfter: r.ran_after, day1: r.day1, medExitDay: num(r.med_exit_day) })),
      winners: { n: Number(r0.win_n ?? 0), medMaeR: num(r0.win_med_mae ?? null), deep: Number(r0.win_deep ?? 0) },
      offered: { n: Number(r0.off_n ?? 0), sumR: Number(r0.off_r ?? 0), sumPeakR: Number(r0.off_peak ?? 0), gaveBack: Number(r0.off_gave_back ?? 0) },
    };
  } catch {
    return EMPTY_POST_MORTEM;
  }
}

/* ---------- follow-through paths (1.7.7, R2 of the Python-studies plan) ---------- */

export interface PathDay {
  day: number;
  /** Mean close-over-entry gain on this day of the trade. */
  mean: number;
  median: number;
  /** Mean of the running lowest low over entry, up to this day. */
  low: number;
}

export interface PathSplit {
  key: string;
  label: string;
  /** Rows with a full PATH_DAYS path in this group (the same on every day). */
  n: number;
  days: PathDay[];
}

export type PathSplitKey = "all" | "adr" | "tape" | "width";

export const PATH_DAYS = 20;
export const PATH_SPLITS: Record<PathSplitKey, { title: string; keys: string[] }> = {
  all: { title: "All", keys: ["all"] },
  adr: { title: "By ADR", keys: ["a1", "a2", "a3"] },
  tape: { title: "By the tape", keys: ["bull", "not"] },
  width: { title: "By stop width", keys: ["tight", "wide"] },
};
const PATH_LABELS: Record<string, string> = {
  all: "Every card the plan entered",
  a1: "ADR 3.5–5%", a2: "ADR 5–7%", a3: "ADR 7%+",
  bull: "Index Bullish at the scan", not: "Index not Bullish",
  tight: "Stop ≤ 1 ADR", wide: "Stop wider than 1 ADR",
};

/**
 * The follow-through paths of the boxed Wait deck cards the next-open plan
 * entered (research_paths, written by the outcomes job): per day 1..20 the mean
 * and median gain over the entry and the mean running low, for every split at
 * once. Only rows with the full twenty days count, so one n holds across the
 * days of a group. Empty groups come back with no days.
 */
export async function getPaths(): Promise<Record<PathSplitKey, PathSplit[]>> {
  const shape = (rows: { split: string; key: string; day: number; n: number; mean: number; median: number; low: number }[]) => {
    const out = {} as Record<PathSplitKey, PathSplit[]>;
    for (const split of Object.keys(PATH_SPLITS) as PathSplitKey[]) {
      out[split] = PATH_SPLITS[split].keys.map((key) => {
        const days = rows
          .filter((r) => r.split === split && r.key === key)
          .map((r) => ({ day: Number(r.day), mean: Number(r.mean), median: Number(r.median), low: Number(r.low) }))
          .sort((a, b) => a.day - b.day);
        const n = Number(rows.find((r) => r.split === split && r.key === key)?.n ?? 0);
        return { key, label: PATH_LABELS[key], n, days };
      });
    }
    return out;
  };
  try {
    const sql = getSql();
    const rows = (await sql`
      WITH b AS (
        SELECT p.day, p.gain, p.low, h.adr_pct, h.market_bullish, o.k_stop_adr
        FROM research_paths p
        JOIN scan_history h USING (date, ticker)
        JOIN research_outcomes o USING (date, ticker)
        WHERE h.rank IS NOT NULL AND h.boxed AND h.verdict = 'wait' AND h.box_top IS NOT NULL AND h.close <= h.box_top
          AND o.path_days >= ${PATH_DAYS}
      ), s AS (
        SELECT 'all' AS split, 'all' AS key, day, gain, low FROM b
        UNION ALL
        SELECT 'adr', CASE WHEN adr_pct < 5 THEN 'a1' WHEN adr_pct < 7 THEN 'a2' ELSE 'a3' END, day, gain, low FROM b WHERE adr_pct IS NOT NULL
        UNION ALL
        SELECT 'tape', CASE WHEN market_bullish THEN 'bull' ELSE 'not' END, day, gain, low FROM b WHERE market_bullish IS NOT NULL
        UNION ALL
        SELECT 'width', CASE WHEN k_stop_adr <= 1 THEN 'tight' ELSE 'wide' END, day, gain, low FROM b WHERE k_stop_adr IS NOT NULL
      )
      SELECT split, key, day, count(*)::int AS n, avg(gain) AS mean,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY gain) AS median, avg(low) AS low
      FROM s GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
    `) as { split: string; key: string; day: number; n: number; mean: number; median: number; low: number }[];
    return shape(rows);
  } catch (err) {
    console.error("getPaths failed:", err);
    return shape([]);
  }
}

/**
 * Best setups (/gallery, 1.6.4): deck rows with twenty sessions of follow-through,
 * best close over the scan-night close first, from `sinceDate` on (null = all
 * history). Fetches a few times `limit` so `pickGallery` can keep one row per
 * ticker and still fill the page. Empty on any error, like every reader here.
 */
export async function getGallery(sinceDate: string | null, limit: number, fiveStar = false): Promise<GalleryRow[]> {
  try {
    const sql = getSql();
    // fiveStar mirrors lib/gallery.ts isFiveStar in SQL: boxed Wait, close at or under the box top.
    const rows = (await sql`
      SELECT h.date::text AS date, h.ticker, h.close, h.verdict, h.boxed, h.box_top, h.box_bottom, h.pivot, h.adr_pct, h.tightness,
             h.dist_from_high, h.ret_1m, h.ret_3m, h.ret_6m, h.market_bullish,
             o.mfe_20, o.mae_20, o.broke_10d, o.broke_day, o.k_r, o.k_stop_adr, o.k_entry_day
      FROM scan_history h JOIN research_outcomes o USING (date, ticker)
      WHERE h.rank IS NOT NULL AND o.complete AND o.mfe_20 IS NOT NULL
        AND h.date >= COALESCE(${sinceDate}::date, '1900-01-01'::date)
        AND (${fiveStar}::boolean = false OR (h.boxed AND h.verdict = 'wait' AND h.box_top IS NOT NULL AND h.close <= h.box_top))
      ORDER BY o.mfe_20 DESC, h.date
      LIMIT ${limit * 8}
    `) as GalleryRowSql[];
    return pickGallery(rows.map(galleryRowFromSql), limit);
  } catch {
    return [];
  }
}

export async function getEpStudy(): Promise<EpStudy> {
  const sql = getSql();
  try {
    const [tot] = (await sql`
      SELECT count(*)::int AS candidates, count(*) FILTER (WHERE taken)::int AS taken, count(r_at_exit)::int AS labelled,
             min(date)::text AS first_date, max(date)::text AS last_date
      FROM research_ep
    `) as { candidates: number; taken: number; labelled: number; first_date: string | null; last_date: string | null }[];
    const agg = (await sql`
      SELECT g.key, count(r_at_exit)::int AS n, avg((r_at_exit > 0)::int) FILTER (WHERE r_at_exit IS NOT NULL) AS win,
             avg(r_at_exit) AS avg_r, avg(mfe_20) AS mfe
      FROM research_ep e,
           LATERAL unnest(ARRAY[
             'all',
             CASE WHEN ret_3m_before IS NULL THEN 'unknown' WHEN ret_3m_before < ${EP_NEGLECT_RET_3M} THEN 'neglected' ELSE 'extended' END,
             CASE WHEN vol_mult IS NULL THEN 'vol_unknown' WHEN vol_mult >= ${EP_VOL_BUCKETS[2]} THEN 'vol_10' WHEN vol_mult >= ${EP_VOL_BUCKETS[1]} THEN 'vol_5' ELSE 'vol_3' END,
             CASE WHEN held_gap THEN 'held' ELSE 'faded' END,
             CASE WHEN ret_3m_before < ${EP_NEGLECT_RET_3M} AND vol_mult >= ${EP_VOL_BUCKETS[2]} THEN 'both' ELSE 'rest' END,
             CASE WHEN ret_3m_before < ${EP_NEGLECT_RET_3M} AND vol_mult >= ${EP_VOL_BUCKETS[2]} AND held_gap THEN 'both_held' ELSE 'rest2' END
           ]) AS g(key)
      WHERE taken GROUP BY g.key
    `) as EpAgg[];
    const recent = (await sql`
      SELECT date::text AS date, ticker, gap_pct, vol_mult, ret_3m_before, held_gap, taken, r_at_exit
      FROM research_ep ORDER BY date DESC, vol_mult DESC NULLS LAST LIMIT 20
    `) as { date: string; ticker: string; gap_pct: number; vol_mult: number | null; ret_3m_before: number | null; held_gap: boolean; taken: boolean | null; r_at_exit: number | null }[];
    const by = new Map(agg.map((r) => [r.key, r]));
    const num = (x: number | null) => (x === null ? null : Number(x));
    return {
      candidates: tot.candidates,
      taken: tot.taken,
      labelled: tot.labelled,
      firstDate: tot.first_date,
      lastDate: tot.last_date,
      overall: epGrp("all", "All taken", by.get("all")),
      byNeglect: [
        epGrp("neglected", `Neglected (3M < +${Math.round(EP_NEGLECT_RET_3M * 100)}%)`, by.get("neglected")),
        epGrp("extended", `Already up (3M ≥ +${Math.round(EP_NEGLECT_RET_3M * 100)}%)`, by.get("extended")),
      ],
      byVolume: [
        epGrp("vol_3", `${EP_VOL_BUCKETS[0]}–${EP_VOL_BUCKETS[1]}× volume`, by.get("vol_3")),
        epGrp("vol_5", `${EP_VOL_BUCKETS[1]}–${EP_VOL_BUCKETS[2]}×`, by.get("vol_5")),
        epGrp("vol_10", `${EP_VOL_BUCKETS[2]}×+`, by.get("vol_10")),
      ],
      byHeld: [epGrp("held", "Closed above its open", by.get("held")), epGrp("faded", "Closed under its open", by.get("faded"))],
      byBoth: [
        epGrp("both", `Neglected and ${EP_VOL_BUCKETS[2]}×+ (his description)`, by.get("both")),
        epGrp("both_held", `… and closed above its open`, by.get("both_held")),
        epGrp("rest", "Everything else", by.get("rest")),
      ],
      recent: recent.map((r) => ({
        date: r.date, ticker: r.ticker, gapPct: Number(r.gap_pct), volMult: num(r.vol_mult), ret3mBefore: num(r.ret_3m_before),
        heldGap: r.held_gap, taken: r.taken, r: num(r.r_at_exit),
      })),
    };
  } catch {
    return EP_EMPTY;
  }
}

/* ---------- per-card research (deck) ---------- */

export interface LikeThis {
  hitRate: number;
  n: number;
  boxed: boolean;
  ep: boolean;
  verdict: string;
}
export interface CardTheme {
  clusterKey: string;
  themeId: number | null;
  name: string; // alias, else the leaders joined
  memberCount: number;
  ret63d: number;
  deckMates: string[]; // other deck tickers in the same cluster
}
export interface CardResearch {
  likeThis: LikeThis | null;
  theme: CardTheme | null;
}
/**
 * For each deck ticker: "setups like this" (same boxed / EP / verdict combination,
 * deck rows only, ≥ 20 labelled) and its theme cluster with the other deck names in it.
 */
export async function deckResearch(cards: { ticker: string; boxed: boolean; ep: boolean; verdict: string }[]): Promise<Record<string, CardResearch>> {
  const out: Record<string, CardResearch> = {};
  if (cards.length === 0) return out;
  const sql = getSql();
  try {
    const like = (await sql`
      SELECT h.boxed, h.ep, h.verdict, count(o.broke_10d)::int AS n, avg(o.broke_10d::int) AS hit
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker)
      WHERE h.rank IS NOT NULL GROUP BY h.boxed, h.ep, h.verdict
    `) as { boxed: boolean; ep: boolean; verdict: string; n: number; hit: number | null }[];
    const clusters = await getClusters(cards.map((c) => c.ticker));
    const clusterOf = new Map<string, Cluster>();
    for (const c of clusters) for (const m of c.inDeck) clusterOf.set(m, c);
    for (const card of cards) {
      const l = like.find((r) => r.boxed === card.boxed && r.ep === card.ep && r.verdict === card.verdict);
      const cl = clusterOf.get(card.ticker);
      out[card.ticker] = {
        likeThis: l && l.hit !== null && l.n >= 20 ? { hitRate: Number(l.hit), n: l.n, boxed: card.boxed, ep: card.ep, verdict: card.verdict } : null,
        theme: cl
          ? { clusterKey: cl.clusterKey, themeId: cl.themeId, name: cl.alias ?? cl.leaders.join(" · "), memberCount: cl.memberCount, ret63d: cl.ret63d, deckMates: cl.inDeck.filter((t) => t !== card.ticker) }
          : null,
      };
    }
  } catch {
    for (const card of cards) out[card.ticker] = { likeThis: null, theme: null };
  }
  return out;
}

/** The sweep's grid must start at the loose limits the scan records; surfaced on /research so drift is visible. */
export const SWEEP_CURRENT = {
  MIN_DOLLAR_VOLUME: CONFIG.MIN_DOLLAR_VOLUME,
  MIN_ADR_PCT: CONFIG.MIN_ADR_PCT,
  MAX_DIST_FROM_HIGH: CONFIG.MAX_DIST_FROM_HIGH,
  MIN_PRICE: CONFIG.MIN_PRICE,
} as const;

/** Realized R of every closed paper position on one track (all users), with its entry date. */
export async function closedTrades(track: "auto" | "manual"): Promise<{ r: number; entryDate: string }[]> {
  try {
    const rows = (await getSql()`
      SELECT p.entry_date::text AS entry_date, p.entry_price, p.initial_stop, p.shares,
             sum(e.exit_price * e.shares)::double precision AS proceeds, sum(e.shares)::int AS sold
      FROM paper_positions p JOIN paper_exits e ON e.position_id = p.id
      WHERE p.track = ${track} AND p.status = 'closed'
      GROUP BY p.id, p.entry_date, p.entry_price, p.initial_stop, p.shares
    `) as { entry_date: string; entry_price: number; initial_stop: number; shares: number; proceeds: number; sold: number }[];
    return rows
      .filter((r) => r.sold > 0 && r.entry_price > r.initial_stop)
      .map((r) => ({ r: (r.proceeds / r.sold - r.entry_price) / (r.entry_price - r.initial_stop), entryDate: r.entry_date }));
  } catch {
    return [];
  }
}

/* ---------- the story: scorecard + rule-change scores ---------- */

/**
 * Labelled deck rows split at `since`: everything before it and everything
 * from it on. Sums, not rates, so the two halves add up to all-history
 * (lib/research-story.ts does the arithmetic).
 */
export async function periodSums(since: string): Promise<{ before: PeriodSums; since: PeriodSums }> {
  const empty = { before: { ...ZERO_SUMS }, since: { ...ZERO_SUMS } };
  try {
    const sql = getSql();
    const rows = (await sql`
      SELECT (h.date >= ${since}::date) AS recent,
             count(o.broke_10d)::int AS n, coalesce(sum(o.broke_10d::int), 0)::int AS hits,
             count(o.broke_10d) FILTER (WHERE h.verdict = 'wait')::int AS wait_n,
             coalesce(sum(o.broke_10d::int) FILTER (WHERE h.verdict = 'wait'), 0)::int AS wait_hits,
             count(o.broke_10d) FILTER (WHERE h.verdict = 'pass')::int AS pass_n,
             coalesce(sum(o.broke_10d::int) FILTER (WHERE h.verdict = 'pass'), 0)::int AS pass_hits,
             count(o.k_r) FILTER (WHERE h.verdict = 'wait')::int AS wait_r_n,
             coalesce(sum(o.k_r) FILTER (WHERE h.verdict = 'wait'), 0)::double precision AS wait_r_sum,
             coalesce(sum(o.k_r * o.k_r) FILTER (WHERE h.verdict = 'wait'), 0)::double precision AS wait_r_sumsq
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker)
      WHERE h.rank IS NOT NULL GROUP BY 1
    `) as { recent: boolean; n: number; hits: number; wait_n: number; wait_hits: number; pass_n: number; pass_hits: number; wait_r_n: number; wait_r_sum: number; wait_r_sumsq: number }[];
    const nights = (await sql`
      SELECT (d.date >= ${since}::date) AS recent, count(*)::int AS nights, count(*) FILTER (WHERE d.bullish)::int AS bullish
      FROM (SELECT date, bool_or(market_bullish) AS bullish FROM scan_history WHERE rank IS NOT NULL GROUP BY date) d GROUP BY 1
    `) as { recent: boolean; nights: number; bullish: number }[];
    const out = empty;
    for (const r of rows) {
      const t = r.recent ? out.since : out.before;
      t.n = Number(r.n); t.hits = Number(r.hits);
      t.waitN = Number(r.wait_n); t.waitHits = Number(r.wait_hits);
      t.passN = Number(r.pass_n); t.passHits = Number(r.pass_hits);
      t.waitRN = Number(r.wait_r_n); t.waitRSum = Number(r.wait_r_sum); t.waitRSumSq = Number(r.wait_r_sumsq);
    }
    for (const r of nights) {
      const t = r.recent ? out.since : out.before;
      t.nights = Number(r.nights); t.bullishNights = Number(r.bullish);
    }
    return out;
  } catch {
    return empty;
  }
}

export interface Story {
  sinceDate: string | null; // the last rule change's first effective scan
  firstRead: string | null; // when "since" can first have labelled rows
  all: Metrics;
  since: Metrics;
  sentence: string;
  changes: ChangeScore[];
}

/** Scorecard (all-history vs since the last rule change) and one scored row per shipped change. */
export async function getStory(changes: RuleChange[] = RULE_CHANGES): Promise<Story> {
  const sinceDate = lastChangeDate(changes);
  const dates = [...new Set(changes.map((c) => c.effective))];
  const sumsByDate = new Map<string, { before: PeriodSums; since: PeriodSums }>();
  await Promise.all(dates.map(async (d) => sumsByDate.set(d, await periodSums(d))));
  const needsTrades = changes.some((c) => c.lens === "paper_avg_r");
  const trades = needsTrades ? await closedTrades("auto") : [];

  const base = sinceDate ? sumsByDate.get(sinceDate)! : await periodSums("9999-12-31");
  const all = metrics(addSums(base.before, base.since));
  const since = metrics(base.since);

  const scored = changes.map((c) => {
    if (c.lens === "paper_avg_r") {
      return scoreChange(c, lensFromTrades(trades.filter((t) => t.entryDate < c.effective).map((t) => t.r)), lensFromTrades(trades.filter((t) => t.entryDate >= c.effective).map((t) => t.r)));
    }
    const s = sumsByDate.get(c.effective)!;
    return scoreChange(c, lensFromMetrics(c.lens, metrics(s.before)), lensFromMetrics(c.lens, metrics(s.since)));
  });
  return { sinceDate, firstRead: sinceDate ? firstReadDate(sinceDate) : null, all, since, sentence: scorecardSentence(all), changes: scored };
}
