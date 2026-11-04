// The story layer of /research: which rule changes have shipped and how each is
// scored, the scorecard arithmetic, the sweep headline and the job health line.
// Pure functions only (no DB) so tests/research-story.test.ts can pin them; the
// readers in lib/research.ts feed them.

/** What a change is measured by. Each lens has its own before/after number. */
export type Lens = "verdict_gap" | "deck_hit" | "paper_avg_r";

export interface RuleChange {
  /** First scan date the rule applied to (the night after it shipped). */
  effective: string;
  version: string;
  label: string;
  lens: Lens;
}

/**
 * One entry per shipped rule change, added in the same commit as the change
 * (like the mistakes.md entry). /research scores each: all labelled history
 * before `effective` against everything from it on.
 */
export const RULE_CHANGES: RuleChange[] = [
  { effective: "2026-09-21", version: "1.3.0", label: "Livermore out of the verdict", lens: "verdict_gap" },
  { effective: "2026-09-21", version: "1.3.2", label: "Screen within 5% of the high", lens: "deck_hit" },
  { effective: "2026-09-21", version: "1.3.2", label: "Paper size scaled by the tape", lens: "paper_avg_r" },
  {
    effective: "2026-10-27",
    version: "1.3.7",
    label: "Auto trades Kullamägi's playbook: buy the open after a close above the box, stop at the day's low, half off day 4, breakeven, 10-day exit",
    lens: "paper_avg_r",
  },
  // 1.6.1 set the floor to 5 from the sweep; 1.6.2 the same afternoon, before any scan ran under it,
  // set 3 and removed the 15% ceiling (Billy's call) — one change as far as the scans are concerned.
  { effective: "2026-11-03", version: "1.6.2", label: "ADR floor 3.5% → 3%, ADR ceiling off (was 15%)", lens: "deck_hit" },
];

/** Labelled rows (or closed trades) the "after" side needs before its number is shown in colour. */
export const MIN_AFTER_N = 30;
/** Sessions until a deck row gets its 10-session label, in calendar days. */
const FIRST_READ_DAYS = 14;

export const LENS_LABEL: Record<Lens, string> = {
  verdict_gap: "Wait − Pass, 10-session breakout",
  deck_hit: "Deck breakout rate, 10 sessions",
  paper_avg_r: "Paper auto book, avg R per closed trade",
};

export function lastChangeDate(changes: RuleChange[] = RULE_CHANGES): string | null {
  return changes.reduce<string | null>((acc, c) => (acc === null || c.effective > acc ? c.effective : acc), null);
}

/** The date the first "after" labels can exist: effective + ten sessions. */
export function firstReadDate(effective: string): string {
  const d = new Date(`${effective}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + FIRST_READ_DAYS);
  return d.toISOString().slice(0, 10);
}

/* ---------- scorecard ---------- */

/** Raw sums for one period (all labelled deck rows either before or from a date). Additive, so periods combine. */
export interface PeriodSums {
  n: number; // labelled deck rows
  hits: number; // of which broke out within 10 sessions
  waitN: number;
  waitHits: number;
  passN: number;
  passHits: number;
  waitRN: number; // Wait rows with an R at exit
  waitRSum: number;
  nights: number; // scan dates
  bullishNights: number; // of which the index verdict was Bullish
}
export const ZERO_SUMS: PeriodSums = { n: 0, hits: 0, waitN: 0, waitHits: 0, passN: 0, passHits: 0, waitRN: 0, waitRSum: 0, nights: 0, bullishNights: 0 };

export function addSums(a: PeriodSums, b: PeriodSums): PeriodSums {
  const out = { ...ZERO_SUMS };
  for (const k of Object.keys(out) as (keyof PeriodSums)[]) out[k] = a[k] + b[k];
  return out;
}

export interface Metrics {
  deckHit: number | null;
  deckN: number;
  waitHit: number | null;
  waitN: number;
  passHit: number | null;
  passN: number;
  gap: number | null; // waitHit − passHit
  waitAvgR: number | null;
  waitRN: number;
  bullishShare: number | null;
  nights: number;
}
const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export function metrics(s: PeriodSums): Metrics {
  const waitHit = ratio(s.waitHits, s.waitN);
  const passHit = ratio(s.passHits, s.passN);
  return {
    deckHit: ratio(s.hits, s.n),
    deckN: s.n,
    waitHit,
    waitN: s.waitN,
    passHit,
    passN: s.passN,
    gap: waitHit === null || passHit === null ? null : waitHit - passHit,
    waitAvgR: ratio(s.waitRSum, s.waitRN),
    waitRN: s.waitRN,
    bullishShare: ratio(s.bullishNights, s.nights),
    nights: s.nights,
  };
}

const pc = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))} point${Math.abs(Math.round(x * 100)) === 1 ? "" : "s"}`;

/** The one-line reading under the tiles: numbers only, no adjectives. */
export function scorecardSentence(all: Metrics): string {
  if (all.deckHit === null) return "No deck rows are labelled yet.";
  const parts = [`${pc(all.deckHit)} of ${all.deckN.toLocaleString()} deck names broke out within 10 sessions`];
  if (all.gap !== null) parts.push(`Wait ${all.gap >= 0 ? "beat" : "trailed"} Pass by ${Math.abs(Math.round(all.gap * 100))} point${Math.abs(Math.round(all.gap * 100)) === 1 ? "" : "s"}`);
  if (all.bullishShare !== null) parts.push(`the tape was Bullish on ${pc(all.bullishShare)} of ${all.nights} nights`);
  return `${parts.join("; ")}.`;
}

/* ---------- rule-change scoring ---------- */

export interface LensValue {
  value: number | null;
  n: number;
}
export interface ChangeScore extends RuleChange {
  before: LensValue;
  after: LensValue;
  ready: boolean; // after.n ≥ MIN_AFTER_N
  firstRead: string; // when the first after-labels can exist
}

/** Pick the lens value out of a period's metrics (paper lenses come from the trade list instead). */
export function lensFromMetrics(lens: Exclude<Lens, "paper_avg_r">, m: Metrics): LensValue {
  if (lens === "verdict_gap") return { value: m.gap, n: Math.min(m.waitN, m.passN) };
  return { value: m.deckHit, n: m.deckN };
}

export function lensFromTrades(rs: number[]): LensValue {
  return { value: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, n: rs.length };
}

export function scoreChange(change: RuleChange, before: LensValue, after: LensValue): ChangeScore {
  return { ...change, before, after, ready: after.n >= MIN_AFTER_N, firstRead: firstReadDate(change.effective) };
}

export function formatLens(lens: Lens, v: number | null): string {
  if (v === null) return "—";
  if (lens === "verdict_gap") return pts(v);
  if (lens === "deck_hit") return pc(v);
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
}

/* ---------- sweep headline ---------- */

export interface SweepHeadlineInput {
  param: string;
  value: number;
  hitRate: number | null;
  n: number;
  isCurrent: boolean;
}
export interface SweepHeadline {
  param: string;
  current: SweepHeadlineInput;
  best: SweepHeadlineInput;
  gap: number; // best − current, in rate
}
/** Minimum labelled rows for a sweep point to count as a candidate "best". */
export const SWEEP_MIN_N = 100;
/** Gaps under this (one point) are noise, and the headline says so. */
export const SWEEP_NOISE = 0.01;

/** The knob whose best value is furthest above its current one, or null when every knob is within a point of its best. */
export function sweepHeadline(points: SweepHeadlineInput[]): SweepHeadline | null {
  let top: SweepHeadline | null = null;
  const params = [...new Set(points.map((p) => p.param))];
  for (const param of params) {
    const ps = points.filter((p) => p.param === param && p.hitRate !== null);
    const current = ps.find((p) => p.isCurrent);
    if (!current || current.hitRate === null) continue;
    const best = ps.filter((p) => p.n >= SWEEP_MIN_N).reduce<SweepHeadlineInput | null>((a, b) => (a === null || b.hitRate! > a.hitRate! ? b : a), null);
    if (!best) continue;
    const gap = best.hitRate! - current.hitRate;
    if (gap >= SWEEP_NOISE && (top === null || gap > top.gap)) top = { param, current, best, gap };
  }
  return top;
}

/* ---------- health ---------- */

export interface HealthRun {
  job: string;
  scanDate: string | null;
  ok: boolean | null;
}
/**
 * One red line when the numbers above may be stale: a failed job, or no
 * research run yet for the latest scan. Null when everything is current.
 */
export function researchHealth(runs: HealthRun[], latestScanDate: string | null): string | null {
  const failed = runs.filter((r) => r.ok === false).map((r) => r.job);
  if (failed.length) return `Research is behind: ${failed.join(", ")} failed on the last run. The numbers on this page may be stale.`;
  if (latestScanDate && runs.length > 0) {
    const behind = runs.filter((r) => r.ok && r.scanDate !== null && r.scanDate < latestScanDate).map((r) => r.job);
    if (behind.length === runs.filter((r) => r.ok).length && behind.length > 0)
      return `No research run yet for the ${latestScanDate} scan; the numbers are as of ${runs.find((r) => r.ok)?.scanDate ?? "the previous run"}.`;
  }
  return null;
}

/* ---------- this week's read ---------- */

export interface ReadInput {
  all: Metrics;
  since: Metrics;
  sinceDate: string | null;
  changes: ChangeScore[];
  /** Share of the universe above its 20-day average: the latest night and ten sessions earlier. */
  breadth: { today: number | null; prev: number | null };
  /** The index filter's verdict on the latest scan. */
  bullish: boolean | null;
  /** Paper size in force (lib/tape.ts). */
  sizeLabel: string;
  /** The episodic-pivot row the interview describes (neglected and 10×+), when the study has one. */
  ep: { label: string; n: number; avgR: number | null } | null;
  jobs: { ok: number; total: number; at: string | null };
}

export interface ResearchRead {
  /** The verdict: "Nothing to change." / "The last change holds." / "Revisit …". */
  headline: string;
  /** Two or three sentences of evidence. */
  body: string;
  /** The grey line: what to keep an eye on, and the job status. */
  watch: string | null;
}

const rrr = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);

/**
 * The research page's verdict, written by rules from the numbers the page
 * already shows (like the card analysis: numbers, no adjectives). The headline
 * follows the rule-change table: a scored change that moved its lens the wrong
 * way asks for a revisit; one that held says so; none scored yet means nothing
 * to change. The body gives the deck's breakout rate since the last change
 * against all history, then the tape. The watch line names the episodic-pivot
 * row and the job status. Pure.
 */
export function researchRead(i: ReadInput): ResearchRead {
  const scored = i.changes.filter((c) => c.ready && c.after.value !== null && c.before.value !== null);
  const worse = scored.filter((c) => c.after.value! < c.before.value!);
  const latest = [...i.changes].sort((a, b) => (a.effective < b.effective ? 1 : -1))[0] ?? null;
  const show = (c: ChangeScore) => `${c.label}: ${formatLens(c.lens, c.after.value)} after against ${formatLens(c.lens, c.before.value)} before, on ${c.after.n.toLocaleString()} rows.`;

  let headline: string;
  let first: string;
  if (worse.length > 0) {
    headline = `Revisit ${worse.map((c) => c.label).join(" and ")}.`;
    first = worse.map(show).join(" ");
  } else if (scored.length > 0) {
    headline = scored.length === 1 ? "The last change holds." : "The scored changes hold.";
    first = scored.map(show).join(" ");
  } else {
    headline = "Nothing to change.";
    first = latest
      ? `${latest.label} has ${latest.after.n.toLocaleString()} rows since ${latest.effective}, under the ${MIN_AFTER_N} it needs for a read.`
      : "No rule change is being scored.";
  }

  const deck =
    i.sinceDate && i.since.deckHit !== null
      ? `The deck's breakout rate since ${i.sinceDate} is ${pc(i.since.deckHit)} on ${i.since.deckN.toLocaleString()}, against ${i.all.deckHit === null ? "—" : pc(i.all.deckHit)} over all history.`
      : i.all.deckHit !== null
        ? `The deck's breakout rate is ${pc(i.all.deckHit)} on ${i.all.deckN.toLocaleString()}${i.sinceDate ? `; nothing is labelled since ${i.sinceDate} yet` : ""}.`
        : "No deck rows are labelled yet.";

  let tape: string;
  if (i.breadth.today === null) tape = `Breadth is not computed yet; paper size ${i.sizeLabel}.`;
  else {
    const move =
      i.breadth.prev === null ? "" : i.breadth.today > i.breadth.prev ? ` (from ${pc(i.breadth.prev)} ten sessions ago)` : i.breadth.today < i.breadth.prev ? ` (down from ${pc(i.breadth.prev)} ten sessions ago)` : ` (flat over ten sessions)`;
    const filter = i.bullish === null ? "the index filter has no read" : i.bullish ? "the index filter is on" : "the index filter is off";
    tape = `Breadth is ${pc(i.breadth.today)}${move} and ${filter}: paper size ${i.sizeLabel}.`;
  }

  const watchParts: string[] = [];
  if (i.ep) watchParts.push(`Watch: ${i.ep.label} is ${rrr(i.ep.avgR)} on ${i.ep.n} results${i.ep.n < MIN_AFTER_N ? `, ${MIN_AFTER_N - i.ep.n} short of a read` : ""}.`);
  if (i.jobs.total > 0) watchParts.push(`Jobs ${i.jobs.ok} of ${i.jobs.total} ok${i.jobs.at ? ` at ${i.jobs.at.slice(11, 19) || i.jobs.at}` : ""}.`);

  return { headline, body: `${first} ${deck} ${tape}`, watch: watchParts.length ? watchParts.join(" ") : null };
}
