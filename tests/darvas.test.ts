import { describe, expect, it } from "vitest";
import { findDarvasBox } from "../lib/darvas";
import { findPivot } from "../lib/livermore";
import { bar, breakoutSetup, flatBars, resetDays, trendBars } from "./fixtures";

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
