import type { BreadthRow } from "./research";
import type { SizeLabel } from "./tape";

/**
 * The tape page (/tape, 1.7.0) in words. Pure readers over the breadth rows the
 * research job writes nightly (each carrying that night's index verdict), so the
 * page can say how long the verdict has held, where breadth is going, and how
 * much of the window was tradeable by his rule.
 */

export interface VerdictStreak {
  /** The latest known verdict; null when no row carries one. */
  bullish: boolean | null;
  /** Sessions the latest verdict has held, counting back from the newest row. */
  sessions: number;
  /** The date the current run started. */
  since: string | null;
}

/** How long the current index verdict has held. Rows ascending by date; rows without a verdict end the count. */
export function verdictStreak(rows: readonly BreadthRow[]): VerdictStreak {
  let i = rows.length - 1;
  while (i >= 0 && rows[i].marketBullish === null) i--;
  if (i < 0) return { bullish: null, sessions: 0, since: null };
  const v = rows[i].marketBullish;
  let start = i;
  while (start - 1 >= 0 && rows[start - 1].marketBullish === v) start--;
  return { bullish: v, sessions: i - start + 1, since: rows[start].date };
}

export interface TapeWindow {
  sessions: number;
  /** Share of sessions with a known verdict that were Bullish; null when none known. */
  bullishShare: number | null;
  /** Longest run of Bullish sessions in the window. */
  longestBullish: number;
  /** Breadth (share above the 20-day) now and ten sessions earlier. */
  breadthNow: number | null;
  breadthTenAgo: number | null;
  /** Sessions in the window with more new highs than new lows. */
  highsOverLowsShare: number | null;
}

/** The window's shape. Rows ascending by date. */
export function tapeWindow(rows: readonly BreadthRow[]): TapeWindow {
  const known = rows.filter((r) => r.marketBullish !== null);
  let longest = 0;
  let run = 0;
  for (const r of rows) {
    run = r.marketBullish ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  const n = rows.length;
  const withHL = rows.filter((r) => r.newHighs + r.newLows > 0);
  return {
    sessions: n,
    bullishShare: known.length ? known.filter((r) => r.marketBullish).length / known.length : null,
    longestBullish: longest,
    breadthNow: n ? rows[n - 1].pctAbove20 : null,
    breadthTenAgo: n > 10 ? rows[n - 11].pctAbove20 : null,
    highsOverLowsShare: withHL.length ? withHL.filter((r) => r.newHighs > r.newLows).length / withHL.length : null,
  };
}

const pc = (x: number) => `${Math.round(x * 100)}%`;

/** One sentence for the top of the page. Pure. */
export function tapeSentence(streak: VerdictStreak, w: TapeWindow, size: { label: SizeLabel; reason: string }): string {
  const parts: string[] = [];
  if (streak.bullish === null) parts.push("No index verdict yet");
  else parts.push(`${streak.bullish ? "Bullish" : "Not bullish"} for ${streak.sessions} session${streak.sessions === 1 ? "" : "s"}${streak.since ? ` (since ${streak.since})` : ""}`);
  if (w.breadthNow !== null) {
    const move = w.breadthTenAgo === null ? "" : w.breadthNow > w.breadthTenAgo + 0.005 ? `, up from ${pc(w.breadthTenAgo)} ten sessions ago` : w.breadthNow < w.breadthTenAgo - 0.005 ? `, down from ${pc(w.breadthTenAgo)} ten sessions ago` : `, flat over ten sessions`;
    parts.push(`breadth ${pc(w.breadthNow)} above the 20-day${move}`);
  }
  if (w.bullishShare !== null) parts.push(`Bullish on ${pc(w.bullishShare)} of the last ${w.sessions} sessions (longest run ${w.longestBullish})`);
  parts.push(`the book sizes at ${size.label === "full" ? "full size" : size.label === "half" ? "half size" : "a quarter"} (${size.reason})`);
  return parts.join(" · ");
}
