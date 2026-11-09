import { CONFIG } from "./config";
import { isFiveStar, type GalleryRow } from "./gallery";
import type { Bar } from "./types";

/**
 * The drill (/drill, 1.8.5): Kullamägi trained his eye on thousands of charts
 * with the right side covered. The gallery shows the charts that worked with the
 * answer attached; the drill shows a scored deck row up to its scan night, with the
 * ticker and date hidden, takes one call — Take or Skip — and then uncovers the
 * twenty sessions after, what the app said that night, and whether the call was
 * right. Every call is kept per reader so the hit rate accumulates. Pure helpers
 * here; the SQL lives in lib/drill-db.ts.
 */

export type DrillCall = "take" | "skip";

/**
 * What the chart did after its scan night:
 *  - never:   no close above its level in ten sessions — a buy-stop placed that night would not have filled
 *  - ran:     a best close at least CONFIG.DRILL.RAN_MFE over the scan-night close within twenty sessions
 *  - fizzled: it cleared the level but went nowhere worth the risk
 */
export type DrillOutcome = "never" | "ran" | "fizzled";

/** right: the call matched what happened · wrong: it did not · nofill: a Take on a chart that never triggered (no trade, no grade). */
export type DrillGrade = "right" | "wrong" | "nofill";

export function drillOutcome(row: Pick<GalleryRow, "mfe20" | "broke10d">): DrillOutcome {
  if (row.broke10d === false) return "never";
  return row.mfe20 >= CONFIG.DRILL.RAN_MFE ? "ran" : "fizzled";
}

export function drillGrade(call: DrillCall, outcome: DrillOutcome): DrillGrade {
  if (call === "take") {
    if (outcome === "never") return "nofill";
    return outcome === "ran" ? "right" : "wrong";
  }
  return outcome === "ran" ? "wrong" : "right";
}

/** The app's own call on the same chart: Take when the row is its 5-star candidate (lib/gallery.ts isFiveStar). */
export function appCall(row: Pick<GalleryRow, "boxed" | "verdict" | "boxTop" | "close">): DrillCall {
  return isFiveStar(row) ? "take" : "skip";
}

/** The bars the reader sees before answering: everything up to and including the scan night. Pure. */
export function blindBars(bars: readonly Bar[], scanDate: string): Bar[] {
  return bars.filter((b) => b.date <= scanDate);
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(0)}%`;

/** The one line that tells the reader how the call went. Pure. */
export function drillVerdictText(call: DrillCall, row: Pick<GalleryRow, "mfe20" | "broke10d">): string {
  const outcome = drillOutcome(row);
  const grade = drillGrade(call, outcome);
  const you = call === "take" ? "You took it" : "You skipped it";
  const what =
    outcome === "never"
      ? "it never closed above its level in ten sessions"
      : outcome === "ran"
        ? `it ran ${pct(row.mfe20)} at best in twenty sessions`
        : `it cleared its level but only made ${pct(row.mfe20)} at best`;
  const verdict = grade === "right" ? (call === "take" ? "a hit" : "right to pass") : grade === "wrong" ? (call === "take" ? "a miss" : "one that got away") : "no fill, no grade";
  return `${you} · ${what} · ${verdict}.`;
}

export interface DrillAnswer {
  call: DrillCall;
  row: GalleryRow;
}

export interface DrillScore {
  /** Calls made. */
  n: number;
  right: number;
  wrong: number;
  nofill: number;
  /** right / (right + wrong), null before the first graded call. */
  hitRate: number | null;
  /** The 5-star rule's hit rate on the same charts, graded the same way. */
  appHitRate: number | null;
  /** Of the charts you took, the share that ran — the trader's number. Null before the first filled take. */
  takeRanShare: number | null;
  /** Of the charts the 5-star rule took, the share that ran. */
  appTakeRanShare: number | null;
  /** The share of every chart you saw that ran: what a coin toss would hit. */
  ranShare: number;
}

function hit(calls: DrillCall[], outcomes: DrillOutcome[]): { right: number; wrong: number; nofill: number; takes: number; takesRan: number } {
  let right = 0;
  let wrong = 0;
  let nofill = 0;
  let takes = 0;
  let takesRan = 0;
  calls.forEach((c, i) => {
    const g = drillGrade(c, outcomes[i]);
    if (g === "right") right++;
    else if (g === "wrong") wrong++;
    else nofill++;
    if (c === "take" && outcomes[i] !== "never") {
      takes++;
      if (outcomes[i] === "ran") takesRan++;
    }
  });
  return { right, wrong, nofill, takes, takesRan };
}

const share = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** The reader's record against the app's rule and the base rate, on the charts answered so far. Pure. */
export function drillScore(answers: readonly DrillAnswer[]): DrillScore {
  const outcomes = answers.map((a) => drillOutcome(a.row));
  const you = hit(
    answers.map((a) => a.call),
    outcomes,
  );
  const app = hit(
    answers.map((a) => appCall(a.row)),
    outcomes,
  );
  const n = answers.length;
  return {
    n,
    right: you.right,
    wrong: you.wrong,
    nofill: you.nofill,
    hitRate: share(you.right, you.right + you.wrong),
    appHitRate: share(app.right, app.right + app.wrong),
    takeRanShare: share(you.takesRan, you.takes),
    appTakeRanShare: share(app.takesRan, app.takes),
    ranShare: n > 0 ? outcomes.filter((o) => o === "ran").length / n : 0,
  };
}

const pctInt = (x: number) => `${Math.round(x * 100)}%`;

/** The score in one sentence. Pure. */
export function drillScoreText(s: DrillScore): string {
  if (s.n === 0) return "No calls yet. Cover the right side, make the call, then look.";
  const parts = [`${s.n} chart${s.n === 1 ? "" : "s"} called`];
  if (s.hitRate !== null) parts.push(`you ${pctInt(s.hitRate)} right`);
  if (s.appHitRate !== null) parts.push(`the 5-star rule ${pctInt(s.appHitRate)}`);
  if (s.nofill > 0) parts.push(`${s.nofill} no fill`);
  if (s.takeRanShare !== null) parts.push(`${pctInt(s.takeRanShare)} of your takes ran`);
  parts.push(`${pctInt(s.ranShare)} of all charts ran`);
  return parts.join(" · ");
}
