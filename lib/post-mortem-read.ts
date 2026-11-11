/**
 * The stop post-mortem (/studies, 1.8.9) in words. research/replay.py
 * post_mortem takes each plan trade apart on its twenty sessions; getPostMortem
 * (lib/research.ts) groups the rows; this file turns the groups into the
 * card's numbers and one fixed-template sentence. Pure.
 *
 * Two leaks are counted the same way, as a share of all trades, so they can be
 * set side by side:
 *  shaken out  ended at the first stop, then closed PM_RAN_R or more over the
 *              entry later in the window. The stop was the problem.
 *  gave back   the best close while the trade was held was one R or more and
 *              the routine kept less than half of it. The exit was the problem.
 *
 * Both are measured in R and the second only on sessions the trade was held:
 * the first version (1.8.9) used the window's best close and a 15% run, which
 * counted every stopped-then-ran trade as an exit give-back and set a five-R
 * bar on the stop (the median risk is 3%). mistakes.md 2026-11-10.
 */

/** A best close this many R over the entry after the exit = the trade "ran after". Two R is about what a close-under-the-average exit makes. */
export const PM_RAN_R = 2;

/** Mirrors research/replay.py PM_REASONS, in order. */
export const PM_REASONS = ["stop", "breakeven", "ma", "open"] as const;
export type PmReasonKey = (typeof PM_REASONS)[number];
export const PM_REASON_LABEL: Record<PmReasonKey, string> = {
  stop: "First stop",
  breakeven: "Breakeven stop",
  ma: "Close under the average",
  open: "Still open on day 20",
};

export interface PmReason {
  reason: PmReasonKey;
  n: number;
  avgR: number | null;
  /** Trades whose best close after the exit was PM_RAN_R or more over the entry. */
  ranAfter: number;
  /** Trades that ended on the entry day itself. */
  day1: number;
  medExitDay: number | null;
}

export interface PostMortem {
  reasons: PmReason[];
  /** Trades that ended above zero R: how far they went against the entry first. */
  winners: { n: number; medMaeR: number | null; deep: number };
  /** Trades whose best close while held was one R or more. */
  offered: { n: number; sumR: number; sumPeakR: number; gaveBack: number };
}

export const EMPTY_POST_MORTEM: PostMortem = {
  reasons: [],
  winners: { n: 0, medMaeR: null, deep: 0 },
  offered: { n: 0, sumR: 0, sumPeakR: 0, gaveBack: 0 },
};

export interface PostMortemRead {
  state: "empty" | "thin" | "stop" | "exit" | "even";
  total: number;
  avgR: number | null;
  /** Share of first-stop exits that ran afterwards. */
  shakeoutRate: number | null;
  /** Shaken-out trades as a share of all trades. */
  shakenShare: number | null;
  /** Gave-back trades as a share of all trades. */
  gaveBackShare: number | null;
  /** R kept over the best close while held, on the trades that reached one R or more. */
  capture: number | null;
  openShare: number | null;
  /** Trades stopped on the entry day, as a share of all trades. */
  day1StopShare: number | null;
  sentence: string;
}

const pc = (x: number) => `${Math.round(x * 100)}%`;
const rr = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}R`;

/** The leaks must differ by this much of all trades before the read names one. */
export const PM_LEAK_GAP = 0.03;

export function postMortemRead(pm: PostMortem, minN = 30): PostMortemRead {
  const total = pm.reasons.reduce((s, r) => s + r.n, 0);
  const none: PostMortemRead = {
    state: "empty", total, avgR: null, shakeoutRate: null, shakenShare: null, gaveBackShare: null, capture: null, openShare: null, day1StopShare: null,
    sentence: "No post-mortem yet. The outcomes job writes it on its next run.",
  };
  if (total === 0) return none;
  const by = (k: PmReasonKey) => pm.reasons.find((r) => r.reason === k) ?? null;
  const stop = by("stop");
  const avgR = pm.reasons.reduce((s, r) => s + (r.avgR ?? 0) * r.n, 0) / total;
  const shakeoutRate = stop && stop.n > 0 ? stop.ranAfter / stop.n : null;
  const shakenShare = (stop?.ranAfter ?? 0) / total;
  const gaveBackShare = pm.offered.gaveBack / total;
  const capture = pm.offered.sumPeakR > 0 ? pm.offered.sumR / pm.offered.sumPeakR : null;
  const openShare = (by("open")?.n ?? 0) / total;
  const day1StopShare = (stop?.day1 ?? 0) / total;
  const base = { total, avgR, shakeoutRate, shakenShare, gaveBackShare, capture, openShare, day1StopShare };
  if (total < minN) {
    return { ...base, state: "thin", sentence: `${total} trades taken apart so far. The read waits for ${minN}.` };
  }
  const facts =
    `${pc((stop?.n ?? 0) / total)} of ${total.toLocaleString()} trades ended at the first stop` +
    (shakeoutRate === null ? "." : ` (${pc(day1StopShare)} of all trades on the entry day itself), and ${pc(shakeoutRate)} of those closed ${PM_RAN_R}R or more over the entry later in the window.`) +
    (pm.winners.medMaeR === null ? "" : ` The winners went a median of ${rr(pm.winners.medMaeR)} against the entry first.`) +
    (capture === null ? "" : ` Where a held trade reached one R or more, the routine kept ${pc(capture)} of its best close.`) +
    ` ${pc(openShare)} were still open on day 20, so the window cuts those short.`;
  const gap = gaveBackShare - shakenShare;
  const state = gap > PM_LEAK_GAP ? "exit" : gap < -PM_LEAK_GAP ? "stop" : "even";
  const verdict =
    state === "exit"
      ? ` The exit leaks more than the stop: ${pc(gaveBackShare)} of all trades gave back over half of a one-R move, against ${pc(shakenShare)} shaken out.`
      : state === "stop"
        ? ` The stop leaks more than the exit: ${pc(shakenShare)} of all trades were shaken out before a run, against ${pc(gaveBackShare)} that gave back over half of a one-R move.`
        : ` The two leaks are about the same size: ${pc(shakenShare)} of all trades shaken out, ${pc(gaveBackShare)} gave back over half of a one-R move.`;
  return { ...base, state, sentence: facts + verdict };
}
