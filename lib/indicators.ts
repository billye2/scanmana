import type { Bar, EpSignal } from "./types";

// All functions assume `bars` is ascending by date.

export function lastClose(bars: Bar[]): number {
  return bars[bars.length - 1].c;
}

/** Fractional return over `lookback` trading days (0.25 = +25%). */
export function pctReturn(bars: Bar[], lookback: number): number | null {
  if (bars.length < lookback + 1) return null;
  const past = bars[bars.length - 1 - lookback].c;
  if (past <= 0) return null;
  return bars[bars.length - 1].c / past - 1;
}

/** Average Daily Range % over `window` days: mean(high/low - 1) * 100. */
export function adrPct(bars: Bar[], window: number): number | null {
  if (bars.length < window) return null;
  let sum = 0;
  for (const b of bars.slice(-window)) {
    if (b.l <= 0) return null;
    sum += b.h / b.l - 1;
  }
  return (sum / window) * 100;
}

/** Simple moving average of closes; `offset` shifts the window back in time. */
export function sma(bars: Bar[], period: number, offset = 0): number | null {
  const end = bars.length - offset;
  if (end - period < 0) return null;
  let sum = 0;
  for (let i = end - period; i < end; i++) sum += bars[i].c;
  return sum / period;
}

export function smaRising(bars: Bar[], period: number, slopeLookback: number): boolean {
  const now = sma(bars, period);
  const then = sma(bars, period, slopeLookback);
  return now !== null && then !== null && now > then;
}

export function avgDollarVolume(bars: Bar[], window: number): number | null {
  if (bars.length < window) return null;
  let sum = 0;
  for (const b of bars.slice(-window)) sum += b.c * b.v;
  return sum / window;
}

/** Fractional distance of last close below the `lookback`-day high. */
export function distFromHigh(bars: Bar[], lookback: number): number | null {
  if (bars.length < lookback) return null;
  let hi = -Infinity;
  for (const b of bars.slice(-lookback)) hi = Math.max(hi, b.h);
  if (hi <= 0) return null;
  return (hi - lastClose(bars)) / hi;
}

/** (range% of last `window` days) / ADR%. Lower = tighter consolidation. */
export function tightness(bars: Bar[], window: number, adr: number): number | null {
  if (bars.length < window || adr <= 0) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of bars.slice(-window)) {
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
  }
  const rangePct = ((hi - lo) / lastClose(bars)) * 100;
  return rangePct / adr;
}

/** Episodic-pivot detection: gap up >= minGap on >= volMult x average volume, within the last `lookback` sessions. */
export function detectEp(
  bars: Bar[],
  opts: { LOOKBACK: number; MIN_GAP: number; VOL_MULT: number; VOL_WINDOW: number },
): EpSignal | null {
  const n = bars.length;
  for (let i = n - 1; i >= Math.max(1 + opts.VOL_WINDOW, n - opts.LOOKBACK); i--) {
    const prev = bars[i - 1];
    if (prev.c <= 0) continue;
    const gap = bars[i].o / prev.c - 1;
    if (gap < opts.MIN_GAP) continue;
    let volSum = 0;
    for (let j = i - opts.VOL_WINDOW; j < i; j++) volSum += bars[j].v;
    const avgVol = volSum / opts.VOL_WINDOW;
    if (avgVol > 0 && bars[i].v >= opts.VOL_MULT * avgVol) {
      return { date: bars[i].date, gapPct: gap, volMult: bars[i].v / avgVol };
    }
  }
  return null;
}
