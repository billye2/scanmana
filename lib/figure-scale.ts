/**
 * Geometry for the drawn diagrams on /help (components/HelpFigures.tsx, 1.9.6).
 * The figures are schematic: a hand-written list of closes becomes candles, and
 * these helpers place them in an SVG box. Pure.
 */

/** open, high, low, close */
export type FigBar = readonly [o: number, h: number, l: number, c: number];

export interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Wick sizes cycled over the bars so a made-up series does not look ruled. */
const WICKS = [0.008, 0.012, 0.006, 0.01] as const;

/**
 * Candles from a list of closes: each bar opens at the previous close and gets a
 * small wick on both ends. `set` overrides single fields of single bars (a high
 * that has to be the ceiling, a low that has to be the stop).
 */
export function barsFromCloses(closes: readonly number[], set: Record<number, Partial<{ o: number; h: number; l: number }>> = {}): FigBar[] {
  return closes.map((c, i) => {
    const over = set[i] ?? {};
    const o = over.o ?? (i === 0 ? c * 0.995 : closes[i - 1]);
    const h = over.h ?? Math.max(o, c) * (1 + WICKS[i % WICKS.length]);
    const l = over.l ?? Math.min(o, c) * (1 - WICKS[(i + 2) % WICKS.length]);
    return [o, Math.max(h, o, c), Math.min(l, o, c), c] as const;
  });
}

/** price → y inside the frame, the highest high (or `extra` price) at the top edge and the lowest at the bottom. */
export function priceScale(bars: readonly FigBar[], frame: Pick<Frame, "top" | "bottom">, extra: readonly number[] = []): (price: number) => number {
  const hi = Math.max(...bars.map((b) => b[1]), ...extra);
  const lo = Math.min(...bars.map((b) => b[2]), ...extra);
  const span = hi - lo || 1;
  return (price) => frame.bottom - ((price - lo) / span) * (frame.bottom - frame.top);
}

/** The slot width of one of `n` bars across the frame. */
export function slotWidth(n: number, frame: Pick<Frame, "left" | "right">): number {
  return (frame.right - frame.left) / Math.max(1, n);
}

/** The centre x of bar `i` of `n`, in evenly spaced slots across the frame. */
export function candleX(i: number, n: number, frame: Pick<Frame, "left" | "right">): number {
  return frame.left + (i + 0.5) * slotWidth(n, frame);
}

/** The mean of the last `period` values up to and including each index; null until `period` values exist. */
export function rollingMean(values: readonly number[], period: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period];
    return i >= period - 1 ? sum / period : null;
  });
}
