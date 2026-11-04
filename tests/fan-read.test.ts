import { describe, expect, it } from "vitest";
import { cumulativePath, fanSentence } from "../lib/fan-read";
import type { Fan } from "../lib/research";

const row = (t: number) => ({ trades: t, q05: -0.3 * t, q25: -0.1 * t, q50: 0.05 * t, q75: 0.2 * t, q95: 0.4 * t });
const fan = (bookTrades: number | null, bookPct: number | null): Fan => ({ rows: Array.from({ length: 60 }, (_, i) => row(i + 1)), bookTrades, bookPct, asOf: "2026-11-03" });

describe("cumulativePath", () => {
  it("sums R in entry order", () => {
    expect(cumulativePath([{ r: 1, entryDate: "2026-10-29" }, { r: -1, entryDate: "2026-10-27" }, { r: 0.5, entryDate: "2026-10-28" }])).toEqual([-1, -0.5, 0.5]);
    expect(cumulativePath([])).toEqual([]);
  });
});

describe("fanSentence", () => {
  it("says so without a fan or without trades", () => {
    expect(fanSentence({ rows: [], bookTrades: null, bookPct: null, asOf: null }, [])).toMatch(/^No fan yet/);
    expect(fanSentence(fan(null, null), [])).toMatch(/no closed Auto trade/);
  });
  it("places the book at its percentile with the row's bands", () => {
    const s = fanSentence(fan(3, 0.31), [1, 0.5, 0.9]);
    expect(s).toBe("The book's 3 trades sit at +0.9R — the 31st percentile of what this plan's history produces by chance (after 3 trades the median is +0.2R, the middle half −0.3R to +0.6R, the 5–95% fan −0.9R to +1.2R). Where chance would put it.");
  });
  it("calls the tails and skips the percentile when the job scored another count", () => {
    expect(fanSentence(fan(2, 0.02), [-2, -3])).toMatch(/2nd percentile.*outside the fan/);
    expect(fanSentence(fan(2, 0.97), [2, 3])).toMatch(/97th percentile.*hot streak/);
    expect(fanSentence(fan(2, 0.5), [1, 1, 1])).not.toMatch(/percentile/);
  });
});
