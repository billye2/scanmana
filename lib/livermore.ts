import { CONFIG } from "./config";
import type { Bar } from "./types";

/**
 * Pragmatic Livermore pivotal point: the highest confirmed swing high in the
 * lookback window — the resistance line whose clean break is the trigger.
 * A swing high = a bar whose high exceeds the highs of `width` bars on each side.
 */
export function findPivot(
  bars: Bar[],
  opts: { width: number; lookback: number } = CONFIG.PIVOT,
): number | null {
  const n = bars.length;
  const start = Math.max(opts.width, n - opts.lookback);
  let best: number | null = null;
  for (let i = start; i < n - opts.width; i++) {
    const h = bars[i].h;
    let isPivot = true;
    for (let j = i - opts.width; j <= i + opts.width; j++) {
      if (j !== i && bars[j].h > h) {
        isPivot = false;
        break;
      }
    }
    if (isPivot && (best === null || h > best)) best = h;
  }
  return best;
}
