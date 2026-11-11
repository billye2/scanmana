import { CONFIG } from "./config";
import { lowestLow } from "./indicators";
import type { GalleryRow } from "./gallery";
import type { Bar } from "./types";

/**
 * The drill's second question (1.9.2, step 3 of the stop-manager list): after a
 * Take on a boxed card, the reader places the stop on the still-covered chart,
 * then sees what each stop did on the same trade.
 *
 * The trade is the Auto book's: buy the open after the first close above the box
 * top within STOP_BREAK_WINDOW sessions, sell by the book's routine (half off at
 * the day-PARTIAL_DAY open when the prior close is above the entry, stop to
 * breakeven, the rest at the open after a close under the MA-day average). Only
 * the first stop differs between the four choices, so the table under the answer
 * is the same trade four times with one thing changed.
 *
 * replayKullamagi mirrors research/replay.py _replay_kullamagi by hand, and the
 * window is research/outcomes.py GRID_DAYS; tests/drill-stop.test.ts pins both to
 * numbers computed by the Python on the same bars. Pure.
 */

const K = CONFIG.PAPER.KULLAMAGI;

/** Mirrors research/outcomes.py BREAK_WINDOW and GRID_DAYS. */
export const STOP_BREAK_WINDOW = 10;
export const STOP_GRID_DAYS = 60;

/** Tightest first on a typical card. breakout_low is the book's own stop. */
export const STOP_KEYS = ["breakout_low", "adr", "low10", "box_bottom"] as const;
export type StopKey = (typeof STOP_KEYS)[number];
export const BOOK_STOP: StopKey = "breakout_low";

export const STOP_LABEL: Record<StopKey, string> = {
  breakout_low: "Breakout day's low",
  adr: "One ADR under the entry",
  low10: "Tonight's 10-session low",
  box_bottom: "Box bottom",
};

export function isStopKey(x: unknown): x is StopKey {
  return typeof x === "string" && (STOP_KEYS as readonly string[]).includes(x);
}

type PlanRow = Pick<GalleryRow, "date" | "close" | "boxed" | "boxTop" | "boxBottom" | "adrPct">;

/** The cards the question is asked on: boxed and resting at or under the top, the rows the plan can enter. */
export function inStopDrill(row: Pick<GalleryRow, "boxed" | "boxTop" | "close">): boolean {
  return row.boxed && row.boxTop !== null && row.close <= row.boxTop;
}

export interface StopChoice {
  key: StopKey;
  label: string;
  /** Known on scan night for the two fixed levels; null for the two set at the entry. */
  price: number | null;
  /** How far under the box top the level sits; for `adr`, one ADR. Null for the breakout day's low. */
  under: number | null;
  note: string;
}

/** The four choices as the reader sees them, priced from the covered bars (everything up to scan night). */
export function stopChoices(row: PlanRow, covered: readonly Bar[]): StopChoice[] {
  const top = row.boxTop ?? row.close;
  const low10 = covered.length > 0 ? lowestLow(covered as Bar[], 10) : null;
  const under = (p: number | null) => (p !== null && top > 0 ? 1 - p / top : null);
  return [
    { key: "breakout_low", label: STOP_LABEL.breakout_low, price: null, under: null, note: "The book's stop. Set when it breaks out, so tonight it has no price." },
    { key: "adr", label: STOP_LABEL.adr, price: null, under: row.adrPct / 100, note: "One average day's range under the fill." },
    { key: "low10", label: STOP_LABEL.low10, price: low10, under: under(low10), note: "The lowest low of the last ten sessions on this chart." },
    { key: "box_bottom", label: STOP_LABEL.box_bottom, price: row.boxBottom, under: under(row.boxBottom), note: "The floor of the box it is resting in." },
  ];
}

export type StopReason = "stop" | "breakeven" | "ma" | "open";

export interface Replay {
  r: number;
  reason: StopReason;
  /** The session the last share left on, entry day = 1. */
  exitDay: number;
}

/**
 * The book's exit on one trade. `window` starts on the entry day; `preCloses` are
 * the closes before it, oldest first, so the average has history from day 2.
 */
export function replayKullamagi(window: readonly Bar[], entry: number, stop: number, preCloses: readonly number[]): Replay | null {
  const risk = entry - stop;
  if (!(risk > 0) || window.length === 0) return null;
  if (window[0].l <= stop) return { r: -1, reason: "stop", exitDay: 1 }; // same-day stop-out, as the engine books it
  const closes = [...preCloses, window[0].c];
  let level = stop;
  let held = 1;
  let r = 0;
  let pending = false;
  let prevClose = window[0].c;
  for (let i = 1; i < window.length; i++) {
    const bar = window[i];
    const day = i + 1;
    if (pending) return { r: r + held * ((bar.o - entry) / risk), reason: "ma", exitDay: day };
    if (day === K.PARTIAL_DAY && held === 1 && prevClose > entry) {
      r += K.PARTIAL_FRACTION * ((bar.o - entry) / risk);
      held -= K.PARTIAL_FRACTION;
      level = Math.max(level, entry);
    }
    if (bar.l <= level) {
      return { r: r + held * ((Math.min(bar.o, level) - entry) / risk), reason: level > stop ? "breakeven" : "stop", exitDay: day };
    }
    closes.push(bar.c);
    prevClose = bar.c;
    const tail = closes.slice(-K.MA);
    if (bar.c < tail.reduce((s, x) => s + x, 0) / tail.length) pending = true;
  }
  const last = window[window.length - 1];
  return { r: r + held * ((last.c - entry) / risk), reason: "open", exitDay: window.length };
}

export interface StopResult {
  key: StopKey;
  /** The stop's price on this trade; null when the level does not exist (no box bottom). */
  stop: number | null;
  /** False when the level is missing or not under the entry: no trade with this stop. */
  usable: boolean;
  /** (entry − stop) / entry. */
  risk: number | null;
  r: number | null;
  reason: StopReason | null;
  exitDay: number | null;
}

export interface StopDrill {
  /** False when no close cleared the box top in the window, or the bars end on the breakout day. */
  filled: boolean;
  breakoutDate: string | null;
  entryDate: string | null;
  entry: number | null;
  /** Sessions the trade had to run, up to STOP_GRID_DAYS. */
  days: number;
  results: StopResult[];
}

const NO_FILL: StopDrill = { filled: false, breakoutDate: null, entryDate: null, entry: null, days: 0, results: [] };

/** Every choice on the row's trade. `bars` are ascending and run from before the scan night to well after it. */
export function gradeStops(row: PlanRow, bars: readonly Bar[]): StopDrill {
  if (row.boxTop === null) return NO_FILL;
  const scanIdx = bars.findLastIndex((b) => b.date <= row.date);
  if (scanIdx < 0) return NO_FILL;
  let b = -1;
  for (let j = scanIdx + 1; j <= scanIdx + STOP_BREAK_WINDOW && j < bars.length; j++) {
    if (bars[j].c > row.boxTop) {
      b = j;
      break;
    }
  }
  if (b < 0 || b + 1 >= bars.length) return NO_FILL;
  const e = b + 1;
  const entry = bars[e].o;
  const window = bars.slice(e, e + STOP_GRID_DAYS);
  const preCloses = bars.slice(Math.max(0, e - K.MA + 1), e).map((x) => x.c);
  const covered = bars.slice(0, scanIdx + 1);
  const price: Record<StopKey, number | null> = {
    breakout_low: bars[b].l,
    adr: entry * (1 - row.adrPct / 100),
    low10: covered.length > 0 ? lowestLow(covered as Bar[], 10) : null,
    box_bottom: row.boxBottom,
  };
  const results = STOP_KEYS.map((key): StopResult => {
    const stop = price[key];
    const rep = stop !== null && stop < entry ? replayKullamagi(window, entry, stop, preCloses) : null;
    if (stop === null || !rep) return { key, stop, usable: false, risk: null, r: null, reason: null, exitDay: null };
    return { key, stop, usable: true, risk: (entry - stop) / entry, r: rep.r, reason: rep.reason, exitDay: rep.exitDay };
  });
  return { filled: true, breakoutDate: bars[b].date, entryDate: bars[e].date, entry, days: window.length, results };
}

const rr = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}R`;
const REASON_TEXT: Record<StopReason, string> = {
  stop: "stopped out",
  breakeven: "out at breakeven",
  ma: "sold under the average",
  open: "still open",
};

/** How one result reads in the table: "stopped out day 2". */
export function stopOutcomeText(res: StopResult): string {
  if (!res.usable || res.reason === null || res.exitDay === null) return res.stop === null ? "no such level" : "not under the entry";
  return `${REASON_TEXT[res.reason]} day ${res.exitDay}`;
}

/** The line over the table: the reader's stop against the book's and the best of the four. */
export function stopVerdictText(drill: StopDrill, chosen: StopKey): string {
  if (!drill.filled) return "It never closed above the box, so there was no trade to put a stop under.";
  const mine = drill.results.find((x) => x.key === chosen);
  if (!mine || !mine.usable || mine.r === null) {
    return `${STOP_LABEL[chosen]} was ${mine?.stop === null ? "not on this chart" : "not under the fill"}, so that stop made no trade.`;
  }
  const usable = drill.results.filter((x) => x.usable && x.r !== null);
  const best = usable.reduce((a, c) => (c.r! > a.r! ? c : a));
  const book = drill.results.find((x) => x.key === BOOK_STOP);
  const head = `Your stop: ${stopOutcomeText(mine)}, ${rr(mine.r)}.`;
  const vsBook =
    chosen === BOOK_STOP || !book || !book.usable || book.r === null
      ? ""
      : ` The book's stop made ${rr(book.r)}.`;
  const bestLabel = STOP_LABEL[best.key];
  const vsBest = best.key === chosen ? " The best of the four." : ` Best of the four: ${bestLabel[0].toLowerCase()}${bestLabel.slice(1)}, ${rr(best.r!)}.`;
  return head + vsBook + vsBest;
}
