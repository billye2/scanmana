import { describe, expect, it } from "vitest";
import { diffInterval, formatInterval, meanInterval, sd, sdFromSums, separated, wilson } from "../lib/stats";

describe("wilson — a rate's 95% range", () => {
  it("brackets the rate, narrowing with n, and stays inside 0..1", () => {
    const wide = wilson(0.8, 20)!;
    const tight = wilson(0.8, 500)!;
    expect(wide.lo).toBeLessThan(0.8);
    expect(wide.hi).toBeGreaterThan(0.8);
    expect(tight.hi - tight.lo).toBeLessThan(wide.hi - wide.lo);
    expect(wilson(1, 10)!.hi).toBe(1);
    expect(wilson(0, 10)!.lo).toBe(0);
  });

  it("matches a hand-worked case: 80% on 193 is about 74–85%", () => {
    const i = wilson(0.798, 193)!;
    expect(i.lo).toBeCloseTo(0.735, 2);
    expect(i.hi).toBeCloseTo(0.849, 2);
  });

  it("is null without trials or a rate", () => {
    expect(wilson(null, 10)).toBeNull();
    expect(wilson(0.5, 0)).toBeNull();
  });
});

describe("meanInterval / sd — an average R's range", () => {
  it("is mean ± 1.96 sd / √n", () => {
    const i = meanInterval(0.1, 1.0, 100)!;
    expect(i.lo).toBeCloseTo(-0.096, 3);
    expect(i.hi).toBeCloseTo(0.296, 3);
  });

  it("is null under two observations or without an sd", () => {
    expect(meanInterval(0.1, 1, 1)).toBeNull();
    expect(meanInterval(0.1, null, 50)).toBeNull();
    expect(meanInterval(null, 1, 50)).toBeNull();
  });

  it("sd from a list and from sums agree", () => {
    const xs = [1, -1, 0.5, 2, -0.5];
    const sum = xs.reduce((a, b) => a + b, 0);
    const sumSq = xs.reduce((a, b) => a + b * b, 0);
    expect(sd(xs)).toBeCloseTo(sdFromSums(sum, sumSq, xs.length)!, 10);
    expect(sd(xs)).toBeCloseTo(1.1937, 3); // mean 0.4, squared deviations sum 5.7, over n−1 = 4
    expect(sd([1])).toBeNull();
  });
});

describe("diffInterval / separated", () => {
  it("brackets the gap between two rates and says whether two ranges are apart", () => {
    const d = diffInterval({ p: 0.75, n: 809 }, { p: 0.61, n: 2000 })!;
    expect(d.lo).toBeGreaterThan(0.1);
    expect(d.hi).toBeLessThan(0.18);
    expect(separated(wilson(0.798, 193), wilson(0.733, 453))).toBe(false); // tonight's deck-mates rows overlap
    expect(separated(wilson(0.75, 809), wilson(0.61, 2000))).toBe(true); // the 5%-of-high change did not
    expect(separated(null, wilson(0.5, 10))).toBeNull();
  });
});

describe("formatInterval", () => {
  it("writes each kind in its own unit", () => {
    expect(formatInterval({ lo: 0.735, hi: 0.849 }, "rate")).toBe("74–85%");
    expect(formatInterval({ lo: -0.02, hi: 0.11 }, "r")).toBe("−0.02 to +0.11R");
    expect(formatInterval({ lo: 0.03, hi: 0.12 }, "pts")).toBe("3 to 12 pts");
    expect(formatInterval(null, "rate")).toBe("");
  });
});
