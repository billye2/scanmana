import { describe, expect, it } from "vitest";
import { EMPTY_POST_MORTEM, type PostMortem, postMortemRead } from "../lib/post-mortem-read";

const pm = (over: Partial<PostMortem> = {}): PostMortem => ({
  reasons: [
    { reason: "stop", n: 40, avgR: -1, ranAfter: 10, medExitDay: 2 },
    { reason: "breakeven", n: 20, avgR: 0.4, ranAfter: 5, medExitDay: 6 },
    { reason: "ma", n: 30, avgR: 1.2, ranAfter: 3, medExitDay: 9 },
    { reason: "open", n: 10, avgR: 3, ranAfter: 0, medExitDay: 20 },
  ],
  winners: { n: 45, medMaeR: -0.3, deep: 9 },
  offered: { n: 50, sumR: 60, sumWindowPeakR: 150, gaveBack: 20 },
  ...over,
});

describe("postMortemRead", () => {
  it("is empty before the job has written a row", () => {
    expect(postMortemRead(EMPTY_POST_MORTEM, 0.15).state).toBe("empty");
  });

  it("waits for thirty trades", () => {
    const thin = pm({ reasons: [{ reason: "stop", n: 12, avgR: -1, ranAfter: 2, medExitDay: 2 }] });
    expect(postMortemRead(thin, 0.15).state).toBe("thin");
  });

  it("weights the average, counts both leaks over all trades and names the larger", () => {
    const r = postMortemRead(pm(), 0.15);
    expect(r.total).toBe(100);
    expect(r.avgR).toBeCloseTo((-40 + 8 + 36 + 30) / 100);
    expect(r.shakeoutRate).toBeCloseTo(0.25);
    expect(r.shakenShare).toBeCloseTo(0.1);
    expect(r.gaveBackShare).toBeCloseTo(0.2);
    expect(r.capture).toBeCloseTo(0.4);
    expect(r.openShare).toBeCloseTo(0.1);
    expect(r.state).toBe("exit");
    expect(r.sentence).toContain("40% of 100 trades ended at the first stop");
    expect(r.sentence).toContain("The exit leaks more than the stop");
  });

  it("names the stop when shakeouts outnumber the give-backs, and neither inside the gap", () => {
    expect(postMortemRead(pm({ offered: { n: 50, sumR: 60, sumWindowPeakR: 150, gaveBack: 4 } }), 0.15).state).toBe("stop");
    expect(postMortemRead(pm({ offered: { n: 50, sumR: 60, sumWindowPeakR: 150, gaveBack: 12 } }), 0.15).state).toBe("even");
  });
});
