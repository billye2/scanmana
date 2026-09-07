import type { Bar } from "../lib/types";

let day = 0;
export function resetDays() {
  day = 0;
}

function nextDate(): string {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + day++);
  return d.toISOString().slice(0, 10);
}

export function bar(o: number, h: number, l: number, c: number, v = 1_000_000): Bar {
  return { date: nextDate(), o, h, l, c, v };
}

/** n flat bars around `price` with ~rangePct daily range. */
export function flatBars(n: number, price: number, rangePct = 0.04, v = 1_000_000): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const h = price * (1 + rangePct / 2);
    const l = price * (1 - rangePct / 2);
    out.push(bar(price, h, l, price, v));
  }
  return out;
}

/** n bars trending from `from` to `to` with ~rangePct daily range. */
export function trendBars(n: number, from: number, to: number, rangePct = 0.05, v = 1_000_000): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const c = from + ((to - from) * (i + 1)) / n;
    const o = from + ((to - from) * i) / n;
    const h = Math.max(o, c) * (1 + rangePct / 2);
    const l = Math.min(o, c) * (1 - rangePct / 2);
    out.push(bar(o, h, l, c, v));
  }
  return out;
}

/**
 * A textbook Qullamaggie setup: long base, strong run-up, then a short tight
 * flag holding just above the run's end (so price sits above rising MAs).
 * One shakeout poke high inside the flag provides the prior swing high (pivot).
 * ~192 bars total.
 */
export function breakoutSetup(): Bar[] {
  resetDays();
  const base = flatBars(120, 20, 0.05);      // 6 months quiet base at $20
  const run = trendBars(60, 20, 42, 0.06);   // ~110% run over 3 months
  const flag = flatBars(12, 42.5, 0.045);    // tight flag just above the run
  flag[2] = { ...flag[2], h: 44.2 };         // shakeout poke — the pivot high
  flag[11] = { ...flag[11], c: 42.9 };       // last close a hair above the MAs
  return [...base, ...run, ...flag];
}
