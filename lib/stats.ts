/**
 * Confidence bands (1.7.6, R1 of the Python-studies plan). Closed-form 95%
 * intervals from each cell's own counts, so every rate and average R on the
 * research pages carries its range and two cells can be told apart or not.
 * Pure. A bootstrap would give the same picture at n ≥ 30 and cost the Python
 * budget; these need only (n, p) or (n, mean, sd), which the readers already
 * return or can add with one aggregate.
 */

export interface Interval {
  lo: number;
  hi: number;
}

const Z = 1.96;

/** Wilson score interval for a rate `p` observed on `n` trials. Null without trials. */
export function wilson(p: number | null, n: number): Interval | null {
  if (p === null || n <= 0) return null;
  const k = Math.round(p * n);
  const phat = k / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const centre = (phat + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** Normal interval for a mean from its sample standard deviation. Null under two observations or without an sd. */
export function meanInterval(mean: number | null, sd: number | null, n: number): Interval | null {
  if (mean === null || sd === null || n < 2 || !Number.isFinite(sd)) return null;
  const half = (Z * sd) / Math.sqrt(n);
  return { lo: mean - half, hi: mean + half };
}

/** Sample standard deviation from a sum and a sum of squares (what an additive period carries). Null under two. */
export function sdFromSums(sum: number, sumSq: number, n: number): number | null {
  if (n < 2) return null;
  const mean = sum / n;
  const variance = Math.max(0, (sumSq - n * mean * mean) / (n - 1));
  return Math.sqrt(variance);
}

/** Sample standard deviation of a list. Null under two. */
export function sd(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  const sumSq = xs.reduce((a, b) => a + b * b, 0);
  return sdFromSums(sum, sumSq, xs.length);
}

/** Interval for the difference of two rates (a − b), each on its own trials. Null when either side is empty. */
export function diffInterval(a: { p: number | null; n: number }, b: { p: number | null; n: number }): Interval | null {
  if (a.p === null || b.p === null || a.n <= 0 || b.n <= 0) return null;
  const se = Math.sqrt((a.p * (1 - a.p)) / a.n + (b.p * (1 - b.p)) / b.n);
  const d = a.p - b.p;
  return { lo: d - Z * se, hi: d + Z * se };
}

/** True when two intervals do not overlap; null when either is missing. */
export function separated(a: Interval | null | undefined, b: Interval | null | undefined): boolean | null {
  if (!a || !b) return null;
  return a.lo > b.hi || b.lo > a.hi;
}

/** "74–86%" or "+0.02 to +0.11R" for a tooltip or a sub-line. */
export function formatInterval(i: Interval | null, kind: "rate" | "r" | "pts"): string {
  if (!i) return "";
  if (kind === "rate") return `${Math.round(i.lo * 100)}–${Math.round(i.hi * 100)}%`;
  if (kind === "pts") return `${Math.round(i.lo * 100)} to ${Math.round(i.hi * 100)} pts`;
  const f = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;
  return `${f(i.lo)} to ${f(i.hi)}R`;
}
