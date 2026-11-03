import { beforeEach, describe, expect, it } from "vitest";
import { autoPlan, takeRisk } from "../lib/plan-line";
import type { DarvasBox } from "../lib/types";
import { bar, flatBars, resetDays } from "./fixtures";

const box = { top: 100, bottom: 92 } as DarvasBox;

describe("autoPlan — the Auto book's decision in words", () => {
  beforeEach(resetDays);

  it("is null until the bars are loaded", () => {
    expect(autoPlan({ box, verdict: "wait" }, null)).toBeNull();
  });

  it("arms on the first close above the box, with the stop at that day's low", () => {
    const bars = [...flatBars(20, 95), bar(100, 103, 98, 101)];
    const p = autoPlan({ box, verdict: "wait" }, bars)!;
    expect(p.arms).toBe(true);
    expect(p.chip).toBe("arms · buy at open");
    expect(p.detail).toContain("98.00");
    expect(p.detail).toContain("-3.0%");
  });

  it("waits inside the box and says how far the close is from the top", () => {
    const bars = flatBars(20, 95);
    const p = autoPlan({ box, verdict: "wait" }, bars)!;
    expect(p.arms).toBe(false);
    expect(p.chip).toBe("waits · inside the box");
    expect(p.detail).toContain("100.00");
    expect(p.detail).toContain("+5.3%");
  });

  it("never arms a Pass card", () => {
    const bars = [...flatBars(20, 95), bar(100, 103, 98, 101)];
    const p = autoPlan({ box, verdict: "pass" }, bars)!;
    expect(p.arms).toBe(false);
    expect(p.tone).toBe("red");
    expect(p.chip).toContain("verdict Pass");
  });

  it("skips a name that broke out before this session", () => {
    const bars = [...flatBars(18, 95), bar(100, 103, 98, 101), bar(101, 104, 100, 103)];
    const p = autoPlan({ box, verdict: "wait" }, bars)!;
    expect(p.arms).toBe(false);
    expect(p.chip).toContain("broke out earlier");
  });

  it("reads a close under the box bottom as a failed box", () => {
    const bars = [...flatBars(20, 95), bar(93, 94, 89, 90)];
    const p = autoPlan({ box, verdict: "wait" }, bars)!;
    expect(p.chip).toContain("under the box");
    expect(p.detail).toContain("92.00");
  });

  it("has nothing to arm without a box", () => {
    const p = autoPlan({ box: null, verdict: "wait" }, flatBars(20, 95))!;
    expect(p.chip).toContain("no box");
  });
});

describe("takeRisk — what a Take would risk, priced like the Take route", () => {
  beforeEach(resetDays);

  it("under the trigger: buy-stop at the top, stop at the box bottom, shares at the tape size", () => {
    const r = takeRisk({ box, pivot: null, price: 95 }, flatBars(20, 95), 0.5)!;
    expect(r.atOpen).toBe(false);
    expect(r.entry).toBe(100);
    expect(r.stop).toBe(92);
    expect(r.riskPct).toBeCloseTo(0.08, 6);
    expect(r.shares).toBe(2); // $250 at half size / $100
  });

  it("above the trigger: next-open entry at the last close, stop at that session's low", () => {
    const bars = [...flatBars(20, 95), bar(100, 103, 98, 101)];
    const r = takeRisk({ box, pivot: null, price: 101 }, bars)!;
    expect(r.atOpen).toBe(true);
    expect(r.entry).toBe(101);
    expect(r.stop).toBe(98);
    expect(r.shares).toBe(4); // $500 / $101
  });

  it("is null with no trigger, or when the stop line is not below the entry", () => {
    expect(takeRisk({ box: null, pivot: null, price: 95 }, flatBars(20, 95))).toBeNull();
    expect(takeRisk({ box: { top: 100, bottom: 100 } as DarvasBox, pivot: null, price: 95 }, flatBars(20, 95))).toBeNull();
  });
});
