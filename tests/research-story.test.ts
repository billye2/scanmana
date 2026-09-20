import { describe, expect, it } from "vitest";
import {
  MIN_AFTER_N,
  RULE_CHANGES,
  ZERO_SUMS,
  addSums,
  firstReadDate,
  formatLens,
  lastChangeDate,
  lensFromMetrics,
  lensFromTrades,
  metrics,
  researchHealth,
  scoreChange,
  scorecardSentence,
  sweepHeadline,
} from "../lib/research-story";

const sums = (over: Partial<typeof ZERO_SUMS>) => ({ ...ZERO_SUMS, ...over });

describe("rule-change registry", () => {
  it("every entry names a version, a lens and a first-effective date after it shipped", () => {
    for (const c of RULE_CHANGES) {
      expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(c.effective).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["verdict_gap", "deck_hit", "paper_avg_r"]).toContain(c.lens);
    }
    expect(lastChangeDate()).toBe("2026-09-21");
    expect(lastChangeDate([])).toBeNull();
  });
  it("first read is ten sessions (14 calendar days) after the change takes effect", () => {
    expect(firstReadDate("2026-09-21")).toBe("2026-10-05");
    expect(firstReadDate("2026-12-25")).toBe("2027-01-08");
  });
});

describe("scorecard metrics", () => {
  const before = sums({ n: 100, hits: 63, waitN: 40, waitHits: 27, passN: 60, passHits: 36, waitRN: 40, waitRSum: 4, nights: 10, bullishNights: 3 });
  it("turns sums into rates and the Wait − Pass gap", () => {
    const m = metrics(before);
    expect(m.deckHit).toBeCloseTo(0.63);
    expect(m.waitHit).toBeCloseTo(0.675);
    expect(m.passHit).toBeCloseTo(0.6);
    expect(m.gap).toBeCloseTo(0.075);
    expect(m.waitAvgR).toBeCloseTo(0.1);
    expect(m.bullishShare).toBeCloseTo(0.3);
  });
  it("an empty period is all nulls, never NaN", () => {
    const m = metrics(ZERO_SUMS);
    expect(m.deckHit).toBeNull();
    expect(m.gap).toBeNull();
    expect(m.waitAvgR).toBeNull();
    expect(m.bullishShare).toBeNull();
  });
  it("periods add, so all-history = before + since", () => {
    const since = sums({ n: 20, hits: 16, waitN: 10, waitHits: 9, passN: 10, passHits: 7, nights: 2, bullishNights: 2 });
    const all = metrics(addSums(before, since));
    expect(all.deckN).toBe(120);
    expect(all.deckHit).toBeCloseTo(79 / 120);
    expect(all.nights).toBe(12);
  });
  it("the sentence reads the numbers and stops", () => {
    expect(scorecardSentence(metrics(before))).toBe("63% of 100 deck names broke out within 10 sessions; Wait beat Pass by 8 points; the tape was Bullish on 30% of 10 nights.");
    expect(scorecardSentence(metrics(ZERO_SUMS))).toBe("No deck rows are labelled yet.");
    const trailing = metrics(sums({ n: 10, hits: 5, waitN: 5, waitHits: 2, passN: 5, passHits: 3 }));
    expect(scorecardSentence(trailing)).toContain("Wait trailed Pass by 20 points");
  });
});

describe("rule-change scoring", () => {
  const m = metrics(sums({ n: 100, hits: 63, waitN: 40, waitHits: 27, passN: 60, passHits: 36 }));
  it("each lens reads its own number and sample size", () => {
    expect(lensFromMetrics("verdict_gap", m)).toEqual({ value: expect.closeTo(0.075, 5), n: 40 });
    expect(lensFromMetrics("deck_hit", m)).toEqual({ value: expect.closeTo(0.63, 5), n: 100 });
    expect(lensFromTrades([1, -1, 0.5])).toEqual({ value: expect.closeTo(1 / 6, 5), n: 3 });
    expect(lensFromTrades([])).toEqual({ value: null, n: 0 });
  });
  it("a change is ready only once the after side has MIN_AFTER_N rows", () => {
    const c = RULE_CHANGES[1];
    const notYet = scoreChange(c, lensFromMetrics("deck_hit", m), { value: 0.7, n: MIN_AFTER_N - 1 });
    expect(notYet.ready).toBe(false);
    expect(notYet.firstRead).toBe("2026-10-05");
    expect(scoreChange(c, lensFromMetrics("deck_hit", m), { value: 0.7, n: MIN_AFTER_N }).ready).toBe(true);
  });
  it("formats each lens in its own unit", () => {
    expect(formatLens("verdict_gap", 0.061)).toBe("+6 points");
    expect(formatLens("verdict_gap", -0.01)).toBe("−1 point");
    expect(formatLens("deck_hit", 0.704)).toBe("70%");
    expect(formatLens("paper_avg_r", 0.114)).toBe("+0.11R");
    expect(formatLens("paper_avg_r", null)).toBe("—");
  });
});

describe("sweep headline", () => {
  const pt = (param: string, value: number, hitRate: number, n = 500, isCurrent = false) => ({ param, value, hitRate, n, isCurrent });
  it("names the knob whose best value is furthest above the current one", () => {
    const h = sweepHeadline([
      pt("A", 1, 0.6, 500, true), pt("A", 2, 0.62), pt("A", 3, 0.7, 50), // the 0.7 point is too thin to count
      pt("B", 1, 0.5), pt("B", 2, 0.55, 500, true), pt("B", 3, 0.6),
    ]);
    expect(h?.param).toBe("B");
    expect(h?.best.value).toBe(3);
    expect(h?.gap).toBeCloseTo(0.05);
  });
  it("is null when every knob is within a point of its best, or nothing is current", () => {
    expect(sweepHeadline([pt("A", 1, 0.6, 500, true), pt("A", 2, 0.605)])).toBeNull();
    expect(sweepHeadline([pt("A", 1, 0.6), pt("A", 2, 0.7)])).toBeNull();
    expect(sweepHeadline([])).toBeNull();
  });
});

describe("research health line", () => {
  const ok = (job: string, scanDate: string) => ({ job, scanDate, ok: true });
  it("is quiet when every job is current", () => {
    expect(researchHealth([ok("outcomes", "2026-09-21"), ok("breadth", "2026-09-21")], "2026-09-21")).toBeNull();
    expect(researchHealth([], "2026-09-21")).toBeNull();
  });
  it("names a failed job", () => {
    expect(researchHealth([ok("outcomes", "2026-09-21"), { job: "sweep", scanDate: "2026-09-21", ok: false }], "2026-09-21")).toMatch(/sweep failed/);
  });
  it("says when the latest scan has no research run yet", () => {
    expect(researchHealth([ok("outcomes", "2026-09-19"), ok("breadth", "2026-09-19")], "2026-09-21")).toMatch(/No research run yet for the 2026-09-21 scan/);
    expect(researchHealth([ok("outcomes", "2026-09-21"), ok("breadth", "2026-09-19")], "2026-09-21")).toBeNull(); // partly current: not stale
  });
});
