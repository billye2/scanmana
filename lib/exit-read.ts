import type { SweepPoint } from "./research";
import { type Interval, meanInterval, separated } from "./stats";

/**
 * The exit sweep (/studies, 1.7.9, R4 of the Python-studies plan) in words.
 * The grid mirrors research/replay.py EXIT_GRID by hand — partial day 3/4/5 ×
 * exit MA 10/20 × breakeven on/off, in that order — and the sweep job writes
 * one research_sweep row per cell under param EXIT_GRID with value = the
 * cell's 1-based index. Pure readers; numbers from the rows, words from one
 * fixed template per state.
 */

export const EXIT_PARTIAL_DAYS = [3, 4, 5] as const;
export const EXIT_MAS = [10, 20] as const;
export const EXIT_BREAKEVENS = [true, false] as const;

export interface ExitCellSpec {
  index: number;
  partialDay: number;
  ma: number;
  breakeven: boolean;
}
export const EXIT_GRID: ExitCellSpec[] = EXIT_PARTIAL_DAYS.flatMap((partialDay) =>
  EXIT_MAS.flatMap((ma) => EXIT_BREAKEVENS.map((breakeven) => ({ index: 0, partialDay, ma, breakeven }))),
).map((c, i) => ({ ...c, index: i + 1 }));

export interface ExitCell extends ExitCellSpec {
  n: number;
  avgR: number | null;
  sdR: number | null;
  winRate: number | null;
  isCurrent: boolean;
  interval: Interval | null;
}

/** The twelve cells from the sweep rows; a cell the job has not written yet has n 0. */
export function exitCells(points: readonly SweepPoint[]): ExitCell[] {
  return EXIT_GRID.map((spec) => {
    const p = points.find((x) => x.param === "EXIT_GRID" && Math.round(x.value) === spec.index);
    const avgR = p?.avgR ?? null;
    const sdR = p?.sdR ?? null;
    const n = p?.n ?? 0;
    return { ...spec, n, avgR, sdR, winRate: p?.hitRate ?? null, isCurrent: p?.isCurrent ?? false, interval: meanInterval(avgR, sdR, n) };
  });
}

export function exitLabel(c: ExitCellSpec): string {
  return `half off day ${c.partialDay} · ${c.ma}-day exit · breakeven ${c.breakeven ? "on" : "off"}`;
}

const rr = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`;

export interface ExitRead {
  state: "empty" | "thin" | "same" | "overlap" | "apart";
  current: ExitCell | null;
  best: ExitCell | null;
  /** Whether the follow-through paths back the best cell's partial day; null when it does not move or the paths are unknown. */
  pathsAgree: boolean | null;
  /** The gate for a scored rule change: ranges apart, both cells at minN, and the paths not against it. */
  gateMet: boolean;
  sentence: string;
}

/**
 * The read under the grid. `pathPeakDay` is the day the mean gain peaks on the
 * follow-through card (R2): when the best cell moves the partial day, the paths
 * agree if the peak sits on the same side of today's partial day.
 */
export function exitRead(cells: readonly ExitCell[], pathPeakDay: number | null, minN = 30): ExitRead {
  const current = cells.find((c) => c.isCurrent) ?? null;
  const scored = cells.filter((c) => c.avgR !== null && c.n > 0);
  const none: ExitRead = { state: "empty", current, best: null, pathsAgree: null, gateMet: false, sentence: "No exit cells yet — the sweep fills this once the outcomes job has written the grid." };
  if (!current || current.avgR === null || scored.length === 0) return none;
  const best = scored.reduce((a, b) => (b.avgR! > a.avgR! ? b : a));
  if (current.n < minN || best.n < minN) {
    return { ...none, state: "thin", best, sentence: `Today's routine (${exitLabel(current)}): ${rr(current.avgR)} on ${current.n.toLocaleString()} rows. The grid needs ${minN} rows before it can say anything.` };
  }
  if (best.index === current.index) {
    return { ...none, state: "same", best, sentence: `Today's routine (${exitLabel(current)}) is the best cell of the twelve: ${rr(current.avgR)} on ${current.n.toLocaleString()} rows. Nothing to change.` };
  }
  const head = `Best cell: ${exitLabel(best)} at ${rr(best.avgR!)} against today's ${rr(current.avgR)} (${current.n.toLocaleString()} rows each)`;
  if (separated(best.interval, current.interval) !== true) {
    return { ...none, state: "overlap", best, sentence: `${head}, but the two ranges overlap — not yet a finding.` };
  }
  let pathsAgree: boolean | null = null;
  let paths = " The paths have no say on the average or the breakeven.";
  if (best.partialDay !== current.partialDay) {
    if (pathPeakDay === null) paths = " The paths cannot weigh in yet (no complete follow-through).";
    else {
      pathsAgree = best.partialDay > current.partialDay === pathPeakDay > current.partialDay;
      paths = pathsAgree ? ` The paths agree: the mean gain peaks on day ${pathPeakDay}.` : ` The paths disagree: the mean gain peaks on day ${pathPeakDay}, so no change yet.`;
    }
  }
  const gateMet = pathsAgree !== false && !(best.partialDay !== current.partialDay && pathPeakDay === null);
  return {
    state: "apart", current, best, pathsAgree, gateMet,
    sentence: `${head}, ranges apart.${paths}${gateMet ? " Gate met — change it as one scored rule-change row, nothing else with it." : ""}`,
  };
}
