import { describe, expect, it } from "vitest";
import { findDarvasBox, findTradeBox } from "../lib/darvas";
import { findPivot } from "../lib/livermore";
import { bar, breakoutSetup, flatBars, resetDays, trendBars } from "./fixtures";

/** The setup plus one bar that closes `pct` above its box top. */
function brokenSetup(pct = 0.03) {
  const bars = breakoutSetup();
  const box = findDarvasBox(bars)!;
  const last = bars[bars.length - 1];
  return { bars, box, broken: [...bars, bar(last.c, box.top * (1 + pct + 0.01), last.c * 0.99, box.top * (1 + pct))] };
}

describe("findTradeBox — the box a close above it is tested against", () => {
  it("the plain box can never be closed above: on the breakout night it is gone", () => {
    const { broken } = brokenSetup();
    expect(findDarvasBox(broken)).toBeNull();
  });

  it("keeps last night's box through the night that breaks it", () => {
    const { box, broken } = brokenSetup();
    const trade = findTradeBox(broken)!;
    expect(trade).toEqual(box);
    expect(broken[broken.length - 1].c).toBeGreaterThan(trade.top);
  });

  it("is the plain box while price is inside it", () => {
    const bars = breakoutSetup();
    expect(findTradeBox(bars)).toEqual(findDarvasBox(bars));
  });

  it("prefers the broken box to an older, taller ceiling found on tonight's bars", () => {
    resetDays();
    // A ceiling at 100, then a lower box 90/85.5 under it (rising highs after the 90 bar, so it is the
    // most recent held ceiling); tonight closes at 93 — above the box, under the ceiling.
    const bars = [...flatBars(30, 80, 0.04), bar(90, 100, 88, 92), ...flatBars(20, 87, 0.03), bar(88, 90, 85.5, 88), ...trendBars(6, 86, 89, 0.02)];
    const prior = findDarvasBox(bars)!;
    expect(prior.top).toBeCloseTo(90, 5);
    const tonight = [...bars, bar(88, 94, 87.5, 93)];
    expect(findDarvasBox(tonight)!.top).toBeCloseTo(100, 5); // the plain box jumps to the ceiling
    expect(findTradeBox(tonight)).toEqual(prior); // the trade box is the one the stock left
  });

  it("the night after the break, the broken box is no longer carried", () => {
    const { broken } = brokenSetup();
    const next = [...broken, bar(44.9, 45.5, 44.4, 45.2)];
    const carried = findTradeBox(next);
    // Either no box (fresh highs) or a box whose top is at or above the close: never "closed above" again.
    expect(carried === null || carried.top >= next[next.length - 1].c).toBe(true);
  });
});

describe("findDarvasBox", () => {
  it("finds the box around a tight flag under the highs", () => {
    const bars = breakoutSetup();
    const box = findDarvasBox(bars);
    expect(box).not.toBeNull();
    // flag sits at $42.5 with 4.5% range: top ≈ 43.46, bottom ≈ 41.54
    expect(box!.top).toBeGreaterThan(43);
    expect(box!.top).toBeLessThan(44);
    expect(box!.bottom).toBeGreaterThan(41);
    expect(box!.bottom).toBeLessThan(42);
    expect(box!.confirmed).toBe(true);
  });

  it("returns null when the stock keeps making new highs", () => {
    resetDays();
    const bars = trendBars(60, 100, 300);
    expect(findDarvasBox(bars)).toBeNull();
  });

  it("returns null when the range is too tall to be a consolidation", () => {
    resetDays();
    const bars = [
      ...flatBars(30, 100, 0.04),
      bar(100, 101, 60, 60), // crash bar: ceiling near the plateau, close at 60
      ...flatBars(3, 60, 0.02), // 'box' from 101 down to ~59 would be ~42% tall
    ];
    expect(findDarvasBox(bars)).toBeNull();
  });
});

describe("findPivot", () => {
  it("marks the highest swing high in the lookback", () => {
    const bars = breakoutSetup();
    const pivot = findPivot(bars);
    expect(pivot).not.toBeNull();
    // the run-up peak (~$45.3 with range) is the significant prior high
    expect(pivot!).toBeGreaterThan(43);
    expect(pivot!).toBeLessThan(48);
  });

  it("returns null when no swing high exists", () => {
    resetDays();
    const bars = trendBars(20, 100, 200); // monotonic — every high beaten immediately
    expect(findPivot(bars, { width: 3, lookback: 20 })).toBeNull();
  });
});
