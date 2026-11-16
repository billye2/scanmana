import { describe, expect, it } from "vitest";
import { EMPTY_SHADOW, EMPTY_SHADOW_GROUP, type ShadowGroup, type ShadowStudy, shadowLive, shadowRead } from "../lib/shadow-read";

const g = (n: number, avgR: number, sdR = 1.5, winRate = 0.4, big = 0): ShadowGroup => ({ n, winRate, avgR, sdR, totalR: n * avgR, big });
const study = (since: { kept: ShadowGroup; dropped: ShadowGroup }): ShadowStudy => ({
  found: { kept: g(75, 0.68, 2.6, 0.49, 11), dropped: g(43, -0.27, 1.3, 0.26, 2) },
  since,
});

describe("shadowLive", () => {
  it("adds the two disjoint groups back into the live rule's row", () => {
    const live = shadowLive(study({ kept: EMPTY_SHADOW_GROUP, dropped: EMPTY_SHADOW_GROUP }).found);
    expect(live.n).toBe(118);
    expect(live.totalR).toBeCloseTo(75 * 0.68 - 43 * 0.27);
    expect(live.avgR).toBeCloseTo((75 * 0.68 - 43 * 0.27) / 118);
    expect(live.winRate).toBeCloseTo((75 * 0.49 + 43 * 0.26) / 118);
    expect(live.big).toBe(13);
    expect(live.sdR).toBeNull();
  });

  it("is empty when no trade exists", () => {
    expect(shadowLive(EMPTY_SHADOW.since)).toEqual(EMPTY_SHADOW_GROUP);
  });
});

describe("shadowRead", () => {
  it("is empty before the job has written the flag", () => {
    const r = shadowRead(EMPTY_SHADOW);
    expect(r.state).toBe("empty");
    expect(r.gateMet).toBe(false);
  });

  it("waits for thirty new trades on each side, whatever the history says", () => {
    const r = shadowRead(study({ kept: g(40, 1.2), dropped: g(12, -0.9) }));
    expect(r.state).toBe("waiting");
    expect(r.gateMet).toBe(false);
    expect(r.sentence).toContain("+0.68R on 75");
    expect(r.sentence).toContain("−0.27R on 43");
    expect(r.sentence).toContain("kept +1.20R on 40, dropped −0.90R on 12");
  });

  it("calls overlapping ranges no finding", () => {
    const r = shadowRead(study({ kept: g(35, 0.3), dropped: g(32, 0.1) }));
    expect(r.state).toBe("overlap");
    expect(r.gateMet).toBe(false);
  });

  it("meets the gate only when the kept trades beat the dropped ones with ranges apart", () => {
    const r = shadowRead(study({ kept: g(60, 0.9, 1.2), dropped: g(40, -0.5, 1.0) }));
    expect(r.state).toBe("for");
    expect(r.gateMet).toBe(true);
  });

  it("says to drop the rule when the new trades run the other way", () => {
    const r = shadowRead(study({ kept: g(60, -0.5, 1.0), dropped: g(40, 0.9, 1.2) }));
    expect(r.state).toBe("against");
    expect(r.gateMet).toBe(false);
  });

  it("reads the new trades alone when the history block is empty", () => {
    const r = shadowRead({ found: EMPTY_SHADOW.found, since: { kept: g(5, 0.2), dropped: g(3, 0.1) } });
    expect(r.state).toBe("waiting");
    expect(r.sentence.startsWith("Since")).toBe(true);
  });
});
