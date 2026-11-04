import { describe, expect, it } from "vitest";
import type { PathDay } from "../lib/research";
import { pathSentence, pathSummary } from "../lib/paths-read";

const day = (d: number, mean: number, low: number): PathDay => ({ day: d, mean, median: mean, low });
const path = [day(1, 0.01, -0.02), day(2, 0.03, -0.03), day(3, 0.05, -0.03), day(4, 0.08, -0.03), day(5, 0.06, -0.04), day(10, 0.07, -0.04), day(20, 0.04, -0.05)];

describe("pathSummary", () => {
  it("finds the peak of the mean gain and the bottom of the running low", () => {
    const s = pathSummary(path, [4, 10, 20]);
    expect(s.peakDay).toBe(4);
    expect(s.peakGain).toBeCloseTo(0.08);
    expect(s.troughDay).toBe(20);
    expect(s.troughLow).toBeCloseTo(-0.05);
    expect(s.marks).toEqual([{ day: 4, gain: 0.08 }, { day: 10, gain: 0.07 }, { day: 20, gain: 0.04 }]);
  });

  it("keeps the first day on ties, skips marks the path lacks, and is empty on no days", () => {
    const flat = [day(1, 0.02, -0.01), day(2, 0.02, -0.01)];
    expect(pathSummary(flat, [2, 7])).toEqual({ peakDay: 1, peakGain: 0.02, marks: [{ day: 2, gain: 0.02 }], troughDay: 1, troughLow: -0.01 });
    expect(pathSummary([], [4])).toEqual({ peakDay: null, peakGain: null, marks: [], troughDay: null, troughLow: null });
  });
});

describe("pathSentence", () => {
  it("writes the peak, the marks and the trough from the numbers", () => {
    expect(pathSentence("Every card the plan entered", 1234, pathSummary(path, [4, 10, 20]))).toBe(
      "Every card the plan entered (1,234 rows): the mean gain over the entry peaks on day 4 at +8.0% — day 4 +8.0%, day 10 +7.0%, day 20 +4.0%. The mean running low bottoms on day 20 at −5.0%.",
    );
  });

  it("says so when there is nothing yet", () => {
    expect(pathSentence("All", 0, pathSummary([], [4]))).toMatch(/^No complete paths yet/);
  });
});
