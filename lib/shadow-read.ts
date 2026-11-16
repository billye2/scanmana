import { type Interval, meanInterval, separated } from "./stats";

/**
 * The shadow rule (/studies, 1.9.4): the Auto book's arming rule with one more
 * condition, scored beside the live rule and never armed.
 *
 *   live    a boxed Wait deck card closes above its box top, stop within one ADR
 *   shadow  the same, and that close is also above the highest high of the
 *           SHADOW_WINDOW sessions before it
 *
 * Why the two differ: a box top is the most recent ceiling that held, so an
 * older, higher high can sit above it inside the last fifty sessions. The live
 * rule buys the break of that lower high; the shadow rule waits for the whole
 * range to clear.
 *
 * Found on 2026-11-15 while checking whether the arming gates missed trades
 * (docs/shadow-new-high-2026-11-15.md): on scan nights through
 * SHADOW_FOUND_THROUGH the 75 trades the shadow keeps averaged +0.68R and the
 * 43 it drops −0.27R. That split was found by looking, so it proves nothing by
 * itself; the scan nights after that date are the test. `kept` and `dropped`
 * never share a trade, which is what lets the card compare them.
 *
 * research/outcomes.py writes the flag (k_new_high, NEW_HIGH_WINDOW mirrors
 * SHADOW_WINDOW and tests/py pins the two); getShadowStudy (lib/research.ts)
 * groups the trades; this file turns the groups into the card's rows and one
 * fixed-template sentence. Pure.
 */

export const SHADOW_WINDOW = 50;
/** The last scan night in the history the rule was found on. Later nights are out of sample. */
export const SHADOW_FOUND_THROUGH = "2026-10-16";

export interface ShadowGroup {
  n: number;
  winRate: number | null;
  avgR: number | null;
  sdR: number | null;
  totalR: number;
  /** Trades that made three R or more. */
  big: number;
}
export interface ShadowPeriod {
  kept: ShadowGroup;
  dropped: ShadowGroup;
}
export interface ShadowStudy {
  /** Scan nights through SHADOW_FOUND_THROUGH: the history the rule was found on. */
  found: ShadowPeriod;
  /** Scan nights after it: trades the study never saw. */
  since: ShadowPeriod;
}

export const EMPTY_SHADOW_GROUP: ShadowGroup = { n: 0, winRate: null, avgR: null, sdR: null, totalR: 0, big: 0 };
export const EMPTY_SHADOW: ShadowStudy = {
  found: { kept: EMPTY_SHADOW_GROUP, dropped: EMPTY_SHADOW_GROUP },
  since: { kept: EMPTY_SHADOW_GROUP, dropped: EMPTY_SHADOW_GROUP },
};

/** The live rule's row: every armed trade, kept and dropped together. No sd, so it carries no range. */
export function shadowLive(p: ShadowPeriod): ShadowGroup {
  const n = p.kept.n + p.dropped.n;
  if (n === 0) return EMPTY_SHADOW_GROUP;
  const wins = (p.kept.winRate ?? 0) * p.kept.n + (p.dropped.winRate ?? 0) * p.dropped.n;
  const totalR = p.kept.totalR + p.dropped.totalR;
  return { n, winRate: wins / n, avgR: totalR / n, sdR: null, totalR, big: p.kept.big + p.dropped.big };
}

export const shadowInterval = (g: ShadowGroup): Interval | null => meanInterval(g.avgR, g.sdR, g.n);

const rr = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`);
const part = (g: ShadowGroup) => (g.n === 0 ? "no trades yet" : `${rr(g.avgR)} on ${g.n.toLocaleString()}`);

export interface ShadowRead {
  /**
   * empty    no trade carries the flag yet
   * waiting  the new trades are short of minN on one side
   * overlap  both sides at minN, ranges overlap
   * for      kept beats dropped on new trades, ranges apart
   * against  dropped beats kept on new trades, ranges apart
   */
  state: "empty" | "waiting" | "overlap" | "for" | "against";
  /** The gate for a scored rule change: state "for". */
  gateMet: boolean;
  sentence: string;
}

/** The read under the card. Only the trades after SHADOW_FOUND_THROUGH can meet the gate. */
export function shadowRead(s: ShadowStudy, minN = 30): ShadowRead {
  const { found, since } = s;
  if (found.kept.n + found.dropped.n + since.kept.n + since.dropped.n === 0) {
    return { state: "empty", gateMet: false, sentence: "No trades carry the flag yet. The outcomes job fills it on its next run." };
  }
  const history = found.kept.n + found.dropped.n === 0 ? "" : `On the history it was found on, the trades it keeps made ${part(found.kept)} and the ones it drops ${part(found.dropped)}. That split was found by looking, so it is not a test. `;
  const fresh = since.kept.n + since.dropped.n === 0 ? `Since ${SHADOW_FOUND_THROUGH}: no new trades yet` : `Since ${SHADOW_FOUND_THROUGH}: kept ${part(since.kept)}, dropped ${part(since.dropped)}`;
  if (since.kept.n < minN || since.dropped.n < minN) {
    return { state: "waiting", gateMet: false, sentence: `${history}${fresh}. It reads at ${minN} new trades on each side; until then the live rule stays as it is.` };
  }
  if (separated(shadowInterval(since.kept), shadowInterval(since.dropped)) !== true) {
    return { state: "overlap", gateMet: false, sentence: `${history}${fresh}. The two ranges overlap, so it is not yet a finding.` };
  }
  if (since.kept.avgR! > since.dropped.avgR!) {
    return { state: "for", gateMet: true, sentence: `${history}${fresh}, ranges apart. Gate met: add the condition to the arming rule as one scored rule-change row, nothing else with it.` };
  }
  return { state: "against", gateMet: false, sentence: `${history}${fresh}, ranges apart the wrong way. The new trades do not back the shadow rule; drop it.` };
}
