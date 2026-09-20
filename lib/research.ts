// Research layer readers + the trigger for the Python job (api/research_job.py).
// Everything here reads research_* / scan_history through getSql(); every reader
// returns an empty shape (never throws) so pages render before the first run.
import { CONFIG } from "./config";
import { getSql } from "./db";
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
  n: number;
  isCurrent: boolean;
}
export async function getSweep(): Promise<SweepPoint[]> {
  try {
    const rows = (await getSql()`SELECT param, value, deck_size, hit_rate, avg_r, n, is_current FROM research_sweep ORDER BY param, value`) as {
      param: string; value: number; deck_size: number; hit_rate: number | null; avg_r: number | null; n: number; is_current: boolean;
    }[];
    return rows.map((r) => ({ param: r.param, value: Number(r.value), deckSize: Number(r.deck_size), hitRate: r.hit_rate === null ? null : Number(r.hit_rate), avgR: r.avg_r === null ? null : Number(r.avg_r), n: r.n, isCurrent: r.is_current }));
  } catch {
    return [];
  }
}

export interface Cluster {
  clusterId: number;
  clusterKey: string;
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
    const rows = (await getSql()`
      SELECT c.cluster_id, c.cluster_key, a.alias, c.leaders, c.members, c.member_count, c.ret_63d, c.as_of::text AS as_of
      FROM research_clusters c LEFT JOIN research_cluster_alias a USING (cluster_key) ORDER BY c.cluster_id
    `) as { cluster_id: number; cluster_key: string; alias: string | null; leaders: string[]; members: string[]; member_count: number; ret_63d: number; as_of: string }[];
    const deck = new Set(deckTickers);
    return rows.map((r) => ({
      clusterId: r.cluster_id,
      clusterKey: r.cluster_key,
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

export async function setClusterAlias(clusterKey: string, alias: string): Promise<void> {
  const sql = getSql();
  if (alias.trim() === "") {
    await sql`DELETE FROM research_cluster_alias WHERE cluster_key = ${clusterKey}`;
    return;
  }
  await sql`
    INSERT INTO research_cluster_alias (cluster_key, alias) VALUES (${clusterKey}, ${alias.trim().slice(0, 40)})
    ON CONFLICT (cluster_key) DO UPDATE SET alias = EXCLUDED.alias, updated_at = now()
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
          ? { clusterKey: cl.clusterKey, name: cl.alias ?? cl.leaders.join(" · "), memberCount: cl.memberCount, ret63d: cl.ret63d, deckMates: cl.inDeck.filter((t) => t !== card.ticker) }
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
             count(o.r_at_exit) FILTER (WHERE h.verdict = 'wait')::int AS wait_r_n,
             coalesce(sum(o.r_at_exit) FILTER (WHERE h.verdict = 'wait'), 0)::double precision AS wait_r_sum
      FROM scan_history h LEFT JOIN research_outcomes o USING (date, ticker)
      WHERE h.rank IS NOT NULL GROUP BY 1
    `) as { recent: boolean; n: number; hits: number; wait_n: number; wait_hits: number; pass_n: number; pass_hits: number; wait_r_n: number; wait_r_sum: number }[];
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
      t.waitRN = Number(r.wait_r_n); t.waitRSum = Number(r.wait_r_sum);
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
