import type { Fan } from "./research";

/**
 * The drawdown fan on /paper (1.8.0, R5 of the Python-studies plan) in words.
 * Pure: the book's cumulative R path from its closed trades in entry order,
 * and one fixed-template sentence placing it against the chance bands.
 */

/** Cumulative R after each closed trade, in entry order (ties by the order given). */
export function cumulativePath(trades: readonly { r: number; entryDate: string }[]): number[] {
  const sorted = [...trades].sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  let sum = 0;
  return sorted.map((t) => (sum += t.r));
}

const rr = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}R`;
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** One sentence under the fan. `path` is the book's cumulative R path. */
export function fanSentence(fan: Fan, path: readonly number[]): string {
  if (fan.rows.length === 0) return "No fan yet — the mc job draws it once the plan has thirty scored rows.";
  const n = path.length;
  if (n === 0) return `The plan's history, shuffled 5,000 times: after ${fan.rows[fan.rows.length - 1].trades} trades the middle half of chance runs from ${rr(fan.rows[fan.rows.length - 1].q25)} to ${rr(fan.rows[fan.rows.length - 1].q75)}. The book has no closed Auto trade to place yet.`;
  const row = fan.rows.find((r) => r.trades === n) ?? fan.rows[fan.rows.length - 1];
  const cum = path[n - 1];
  const pct = fan.bookPct !== null && fan.bookTrades === n ? Math.round(fan.bookPct * 100) : null;
  const where = pct === null ? "" : ` — the ${ordinal(pct)} percentile of what this plan's history produces by chance`;
  const verdict = pct === null ? "" : pct < 5 ? " That is outside the fan: look at the trades, not the plan." : pct < 25 ? " Inside the fan, on its low side — a cold streak the plan's own history allows." : pct > 95 ? " That is outside the fan on the high side: a hot streak, not proof." : pct > 75 ? " Inside the fan, on its high side." : " Where chance would put it.";
  return `The book's ${n} trade${n === 1 ? "" : "s"} sit at ${rr(cum)}${where} (after ${row.trades} trades the median is ${rr(row.q50)}, the middle half ${rr(row.q25)} to ${rr(row.q75)}, the 5–95% fan ${rr(row.q05)} to ${rr(row.q95)}).${verdict}`;
}
