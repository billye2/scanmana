import { beforeEach, describe, expect, it } from "vitest";
import { autoPlan, openGroup, openHint, takeRisk } from "../lib/plan-line";
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

describe("openGroup / openHint — the deck list's sections, from the arming test", () => {
  beforeEach(resetDays);
  const tail = (bars: ReturnType<typeof flatBars>) => bars.slice(-2);

  it("groups a first close above the box as arms, with the Take numbers as the hint", () => {
    const bars = tail([...flatBars(20, 95), bar(100, 103, 98, 101)]);
    const g = openGroup({ box, verdict: "wait" }, bars);
    expect(g).toBe("arms");
    expect(openHint({ box, pivot: null, price: 101 }, g, bars, 0.5)).toBe("stop 98.00 · risk 3.0% · 2 sh");
  });

  it("keeps a Wait card inside its box in the inside group, hinting the distance to the trigger", () => {
    const bars = tail(flatBars(20, 95));
    const g = openGroup({ box, verdict: "wait" }, bars);
    expect(g).toBe("inside");
    expect(openHint({ box, pivot: null, price: 95 }, g, bars)).toBe("+5.3% to trigger");
  });

  it("puts a Wait card it cannot arm in the watch group with no hint", () => {
    const earlier = tail([...flatBars(18, 95), bar(100, 103, 98, 101), bar(101, 104, 100, 103)]);
    expect(openGroup({ box, verdict: "wait" }, earlier)).toBe("watch");
    expect(openGroup({ box, verdict: "wait" }, tail([...flatBars(20, 95), bar(93, 94, 89, 90)]))).toBe("watch");
    expect(openGroup({ box: null, verdict: "wait" }, tail(flatBars(20, 95)))).toBe("watch");
    expect(openHint({ box: null, pivot: 100, price: 95 }, "watch", null)).toBeNull();
  });

  it("every Pass card is pass, whatever the bars say", () => {
    expect(openGroup({ box, verdict: "pass" }, tail([...flatBars(20, 95), bar(100, 103, 98, 101)]))).toBe("pass");
    expect(openGroup({ box, verdict: undefined }, null)).toBe("pass");
  });

  it("without bars a boxed Wait card reads as inside and an unboxed one as watch", () => {
    expect(openGroup({ box, verdict: "wait" }, undefined)).toBe("inside");
    expect(openGroup({ box: null, verdict: "wait" }, undefined)).toBe("watch");
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
