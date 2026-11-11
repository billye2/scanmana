import { describe, expect, it } from "vitest";
import { CONFIG } from "../lib/config";
import { appCall, blindBars, drillGrade, drillOutcome, drillScore, drillScoreText, drillVerdictText, type DrillAnswer } from "../lib/drill";
import { galleryRowFromSql, type GalleryRow, type GalleryRowSql } from "../lib/gallery";
import { flatBars, resetDays } from "./fixtures";

const row = (over: Partial<GalleryRow>): GalleryRow => ({
  date: "2026-06-10",
  ticker: "ABC",
  close: 50,
  verdict: "wait",
  boxed: true,
  boxTop: 52,
  boxBottom: 47,
  pivot: null,
  adrPct: 5,
  tightness: 1.5,
  distFromHigh: 0.04,
  ret1m: 0.3,
  ret3m: 0.8,
  ret6m: 1.5,
  marketBullish: true,
  mfe20: 0.25,
  mae20: -0.03,
  broke10d: true,
  brokeDay: 3,
  kR: 2.1,
  kStopAdr: 0.8,
  kEntryDay: 3,
  ...over,
});

describe("drillOutcome — what the chart did after the night", () => {
  it("never: no close above the level in ten sessions, whatever the best close", () => {
    expect(drillOutcome(row({ broke10d: false, mfe20: 0.02 }))).toBe("never");
    expect(drillOutcome(row({ broke10d: false, mfe20: 0.4 }))).toBe("never");
  });
  it("ran: a best close at or over the RAN_MFE threshold", () => {
    expect(drillOutcome(row({ mfe20: CONFIG.DRILL.RAN_MFE }))).toBe("ran");
    expect(drillOutcome(row({ mfe20: 0.5 }))).toBe("ran");
  });
  it("fizzled: cleared the level but fell short of the threshold", () => {
    expect(drillOutcome(row({ mfe20: 0.05 }))).toBe("fizzled");
    expect(drillOutcome(row({ mfe20: -0.1, broke10d: true }))).toBe("fizzled");
    // An unlabelled broke_10d is not "never": only a recorded false is.
    expect(drillOutcome(row({ mfe20: 0.05, broke10d: null }))).toBe("fizzled");
  });
});

describe("drillGrade — the call against the outcome", () => {
  it("a take is right on a run, wrong on a fizzle, ungraded on no fill", () => {
    expect(drillGrade("take", "ran")).toBe("right");
    expect(drillGrade("take", "fizzled")).toBe("wrong");
    expect(drillGrade("take", "never")).toBe("nofill");
  });
  it("a skip is right unless the chart ran", () => {
    expect(drillGrade("skip", "ran")).toBe("wrong");
    expect(drillGrade("skip", "fizzled")).toBe("right");
    expect(drillGrade("skip", "never")).toBe("right");
  });
});

describe("appCall — the 5-star rule's call", () => {
  it("takes a boxed Wait resting under its box top, skips the rest", () => {
    expect(appCall(row({}))).toBe("take");
    expect(appCall(row({ verdict: "pass" }))).toBe("skip");
    expect(appCall(row({ boxed: false, boxTop: null }))).toBe("skip");
    expect(appCall(row({ close: 53 }))).toBe("skip");
  });
});

describe("blindBars — the covered chart", () => {
  it("keeps the bars up to and including the scan night", () => {
    resetDays();
    const bars = flatBars(10, 50); // 2026-01-01 .. 2026-01-10
    const covered = blindBars(bars, "2026-01-04");
    expect(covered.map((b) => b.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  });
  it("keeps everything when the night is the last bar, nothing when it is before the first", () => {
    resetDays();
    const bars = flatBars(5, 50);
    expect(blindBars(bars, "2026-01-05")).toHaveLength(5);
    expect(blindBars(bars, "2025-12-31")).toHaveLength(0);
  });
});

describe("drillVerdictText — one line on how the call went", () => {
  it("names a hit, a miss, a pass, one that got away, and a no fill", () => {
    expect(drillVerdictText("take", row({ mfe20: 0.32 }))).toBe("You took it · it ran +32% at best in twenty sessions · a hit.");
    expect(drillVerdictText("take", row({ mfe20: 0.04 }))).toBe("You took it · it cleared its level but only made +4% at best · a miss.");
    expect(drillVerdictText("skip", row({ mfe20: 0.04 }))).toBe("You skipped it · it cleared its level but only made +4% at best · right to pass.");
    expect(drillVerdictText("skip", row({ mfe20: 0.32 }))).toBe("You skipped it · it ran +32% at best in twenty sessions · one that got away.");
    expect(drillVerdictText("take", row({ broke10d: false, mfe20: 0.01 }))).toBe(
      "You took it · it never closed above its level in ten sessions · no fill, no grade.",
    );
  });
  it("writes a negative best close with a real minus", () => {
    expect(drillVerdictText("skip", row({ mfe20: -0.06, broke10d: true }))).toContain("only made −6%");
  });
});

describe("drillScore — the record against the rule and the base rate", () => {
  const answers: DrillAnswer[] = [
    { call: "take", row: row({ mfe20: 0.3 }) }, // you right, app (5-star) takes → right
    { call: "take", row: row({ mfe20: 0.05, verdict: "pass" }) }, // you wrong, app skips → right
    { call: "skip", row: row({ mfe20: 0.4, verdict: "pass" }) }, // you wrong (got away), app skips → wrong
    { call: "skip", row: row({ mfe20: 0.02 }) }, // you right, app takes → wrong
    { call: "take", row: row({ mfe20: 0.01, broke10d: false }) }, // you nofill, app takes → nofill
    { call: "skip", row: row({ mfe20: 0.01, broke10d: false, boxed: false, boxTop: null }) }, // you right, app skips → right
  ];

  it("is empty before the first call", () => {
    const s = drillScore([]);
    expect(s.n).toBe(0);
    expect(s.hitRate).toBeNull();
    expect(s.appHitRate).toBeNull();
    expect(s.takeRanShare).toBeNull();
    expect(s.ranShare).toBe(0);
    expect(drillScoreText(s)).toBe("No calls yet. Cover the right side, make the call, then look.");
  });

  it("counts right, wrong and no fill, and leaves no fill out of the hit rate", () => {
    const s = drillScore(answers);
    expect(s.n).toBe(6);
    expect(s.right).toBe(3);
    expect(s.wrong).toBe(2);
    expect(s.nofill).toBe(1);
    expect(s.hitRate).toBeCloseTo(3 / 5);
  });

  it("averages the stops placed against the book's stop on the same trades, and only where both made a trade", () => {
    const placed: DrillAnswer[] = [
      { ...answers[0], stopKey: "adr", stopR: 1.5, bookR: -1 },
      { ...answers[1], stopKey: "box_bottom", stopR: -0.5, bookR: 0.5 },
      { ...answers[2], stopKey: "low10", stopR: null, bookR: 2 },
      answers[3],
    ];
    const s = drillScore(placed);
    expect(s.stops).toBe(2);
    expect(s.stopAvgR).toBeCloseTo(0.5);
    expect(s.bookAvgR).toBeCloseTo(-0.25);
    expect(drillScoreText(s)).toContain("2 stops placed, yours +0.50R a trade against the book's −0.25R");
    expect(drillScore(answers).stops).toBe(0);
    expect(drillScoreText(drillScore(answers))).not.toContain("placed");
  });

  it("grades the 5-star rule on the same charts the same way", () => {
    const s = drillScore(answers);
    // app: right, right, wrong, wrong, nofill, right → 3 / 5
    expect(s.appHitRate).toBeCloseTo(3 / 5);
  });

  it("the trader's number: the share of filled takes that ran, for you and for the rule", () => {
    const s = drillScore(answers);
    // your filled takes: rows 1 (ran) and 2 (fizzled) → 1/2
    expect(s.takeRanShare).toBeCloseTo(0.5);
    // the rule's filled takes: rows 1 (ran) and 4 (fizzled); row 5 never filled → 1/2
    expect(s.appTakeRanShare).toBeCloseTo(0.5);
    // the base rate: rows 1 and 3 ran out of six
    expect(s.ranShare).toBeCloseTo(2 / 6);
  });

  it("says it in one sentence", () => {
    expect(drillScoreText(drillScore(answers))).toBe("6 charts called · you 60% right · the 5-star rule 60% · 1 no fill · 50% of your takes ran · 33% of all charts ran");
    expect(drillScoreText(drillScore([answers[3]]))).toBe("1 chart called · you 100% right · the 5-star rule 0% · 0% of all charts ran");
  });
});

describe("galleryRowFromSql — the SQL shape to the page shape", () => {
  it("maps every snake_case column", () => {
    const sql: GalleryRowSql = {
      date: "2026-06-10", ticker: "ABC", close: 50, verdict: "wait", boxed: true, box_top: 52, box_bottom: 47, pivot: 51,
      adr_pct: 5, tightness: 1.5, dist_from_high: 0.04, ret_1m: 0.3, ret_3m: 0.8, ret_6m: 1.5, market_bullish: true,
      mfe_20: 0.25, mae_20: -0.03, broke_10d: true, broke_day: 3, k_r: 2.1, k_stop_adr: 0.8, k_entry_day: 3,
    };
    expect(galleryRowFromSql(sql)).toEqual(row({ pivot: 51 }));
  });
});
