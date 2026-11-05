import { CONFIG } from "./config";
import type { Bar, DarvasBox } from "./types";

/**
 * Pragmatic Darvas box: within the recent window, find the most recent high
 * that caps every bar after it (held for >= `confirm` sessions) — that's the
 * box top / breakout trigger. The box bottom is the lowest low since that top,
 * "confirmed" once it too has held for >= `confirm` sessions.
 * Returns null when the stock is making fresh highs (no ceiling = no box) or
 * the box is too tall to be a meaningful consolidation.
 */
export function findDarvasBox(
  bars: Bar[],
  opts: { confirm: number; maxWindow: number; maxHeightPct: number } = CONFIG.DARVAS,
): DarvasBox | null {
  const n = bars.length;
  if (n < opts.confirm + 5) return null;
  const start = Math.max(0, n - opts.maxWindow);

  // suffixMax[i] = max high of bars[i..n-1]
  const suffixMax = new Array<number>(n + 1).fill(-Infinity);
  for (let i = n - 1; i >= start; i--) {
    suffixMax[i] = Math.max(bars[i].h, suffixMax[i + 1]);
  }

  let topIdx = -1;
  for (let i = n - 1 - opts.confirm; i >= start; i--) {
    if (bars[i].h >= suffixMax[i + 1]) {
      topIdx = i;
      break;
    }
  }
  if (topIdx < 0) return null;

  const top = bars[topIdx].h;
  let bottom = Infinity;
  let bottomIdx = -1;
  for (let i = topIdx; i < n; i++) {
    if (bars[i].l < bottom) {
      bottom = bars[i].l;
      bottomIdx = i;
    }
  }
  if (!Number.isFinite(bottom) || bottom >= top) return null;
  if ((top - bottom) / top > opts.maxHeightPct) return null;

  return {
    top,
    bottom,
    startDate: bars[topIdx].date,
    confirmed: n - 1 - bottomIdx >= opts.confirm,
  };
}

/**
 * The box a card is traded against tonight: the box the bars through *yesterday*
 * formed, when tonight's close is above its top (the stock just left the box
 * upward — last night's card said "arms on a close above X" and tonight it did);
 * otherwise tonight's own box.
 *
 * Why this exists: `findDarvasBox` on the full bars can never return a box
 * tonight's close is above — the top must cap every later high, tonight's
 * included, so close ≤ high ≤ top. On the breakout day the box either vanished
 * (the stock is the window high) or jumped to an older, taller ceiling, and
 * every "closed above the box" rule (`breakingOut`, `armBlocker`, the Darvas
 * paragraph) was unreachable: the Auto book armed nothing from 1.3.7 (2026-10-25)
 * to 1.8.1 (2026-11-04). The prior box wins even when a taller ceiling exists on
 * tonight's bars, matching what the research layer scores (the first close above
 * the scan-night box, research/outcomes.py `kullamagi_plans`).
 */
export function findTradeBox(
  bars: Bar[],
  opts: { confirm: number; maxWindow: number; maxHeightPct: number } = CONFIG.DARVAS,
): DarvasBox | null {
  const last = bars[bars.length - 1];
  if (last) {
    const prior = findDarvasBox(bars.slice(0, -1), opts);
    if (prior && last.c > prior.top) return prior;
  }
  return findDarvasBox(bars, opts);
}
