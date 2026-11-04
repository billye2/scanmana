import { beforeEach, describe, expect, it } from "vitest";
import { autoPlan, openGroup, openHint, positionLines, takeLadder, takeRisk } from "../lib/plan-line";
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

describe("takeLadder — the stop levels a Take can pick", () => {
  beforeEach(resetDays);

  it("at the open: today's low is the rule, then the box bottom and the 10-session low, tightest first", () => {
    const bars = [...flatBars(20, 95), bar(100, 103, 98, 101)];
    const l = takeLadder({ box, pivot: null, price: 101, adrPct: 4 }, bars)!;
    expect(l.atOpen).toBe(true);
    expect(l.entry).toBe(101);
    expect(l.rungs.map((r) => [r.key, r.price, r.rule])).toEqual([
      ["entry_low", 98, true],
      ["low10", 95 * 0.98, false], // flatBars' low
      ["box_bottom", 92, false],
    ]);
    expect(l.rungs[0].riskPct).toBeCloseTo(1 - 98 / 101, 6);
    expect(l.rungs[0].wide).toBe(false);
    expect(l.rungs[2].wide).toBe(true); // 8.9% is wider than one 4% ADR
    expect(l.adr).toBe(0.04);
  });

  it("under the trigger: the box bottom is the rule and there is no entry-day low yet", () => {
    const l = takeLadder({ box, pivot: null, price: 95, adrPct: 4 }, flatBars(20, 95))!;
    expect(l.atOpen).toBe(false);
    expect(l.entry).toBe(100);
    expect(l.rungs.map((r) => r.key)).toEqual(["box_bottom", "low10"]);
    expect(l.rungs[0].rule).toBe(true);
  });

  it("a pivot-only card offers only the 10-session low, and a level above the entry is left out", () => {
    const l = takeLadder({ box: null, pivot: 100, price: 95, adrPct: 0 }, flatBars(20, 95))!;
    expect(l.rungs.map((r) => r.key)).toEqual(["low10"]);
    expect(l.rungs[0].rule).toBe(false);
    expect(l.adr).toBeNull();
    const above = takeLadder({ box: { top: 100, bottom: 100 } as DarvasBox, pivot: null, price: 95, adrPct: 4 }, flatBars(20, 95))!;
    expect(above.rungs.map((r) => r.key)).toEqual(["low10"]);
  });

  it("is null without a trigger or without bars", () => {
    expect(takeLadder({ box: null, pivot: null, price: 95, adrPct: 4 }, flatBars(20, 95))).toBeNull();
    expect(takeLadder({ box, pivot: null, price: 95, adrPct: 4 }, null)).toBeNull();
  });
});

describe("positionLines — an open position drawn on its chart", () => {
  beforeEach(resetDays);
  const auto = { track: "auto" as const, entryPrice: 100, initialStop: 95, currentStop: 95, trailMode: "kullamagi" as const };

  it("draws entry and stop, and marks the day-4 bar when it is on the chart", () => {
    const bars = flatBars(10, 100); // 2026-01-01 … 2026-01-10
    const d = positionLines({ ...auto, entryDate: "2026-01-03" }, bars);
    expect(d.lines.map((l) => [l.title, l.price])).toEqual([["entry", 100], ["stop", 95]]);
    expect(d.markers).toEqual([{ date: "2026-01-06", text: "day 4" }]);
    expect(d.day4).toEqual({ date: "2026-01-06" });
    expect(d.note).toBe("Auto book position · entry 100.00 on 2026-01-03 · stop 95.00 (-5.0% from entry) · day 4 was 2026-01-06");
  });

  it("adds the first stop in red when the stop has moved, and counts the sessions to day 4", () => {
    const bars = flatBars(10, 100);
    const d = positionLines({ ...auto, entryDate: "2026-01-09", currentStop: 100 }, bars);
    expect(d.lines.map((l) => [l.title, l.style])).toEqual([["entry", "solid"], ["stop now", "solid"], ["first stop", "dashed"]]);
    expect(d.markers).toEqual([]);
    expect(d.day4).toEqual({ away: 2 });
    expect(d.note).toContain("stop 100.00, raised from 95.00 (+0.0% from entry) · day 4 in 2 sessions");
  });

  it("gives a manual position no day-4 marker, and an entry off the chart none either", () => {
    const bars = flatBars(10, 100);
    const manual = positionLines({ ...auto, track: "manual", trailMode: "none", entryDate: "2026-01-03" }, bars);
    expect(manual.day4).toBeNull();
    expect(manual.note.startsWith("Manual position")).toBe(true);
    expect(positionLines({ ...auto, entryDate: "2026-02-01" }, bars).day4).toBeNull();
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
