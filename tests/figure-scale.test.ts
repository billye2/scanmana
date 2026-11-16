import { describe, expect, it } from "vitest";
import { barsFromCloses, candleX, priceScale, rollingMean, slotWidth } from "../lib/figure-scale";

describe("barsFromCloses", () => {
  it("opens each bar at the previous close and keeps high and low outside the body", () => {
    const bars = barsFromCloses([10, 11, 10.5]);
    expect(bars[1][0]).toBe(10);
    expect(bars[2][0]).toBe(11);
    for (const [o, h, l, c] of bars) {
      expect(h).toBeGreaterThanOrEqual(Math.max(o, c));
      expect(l).toBeLessThanOrEqual(Math.min(o, c));
    }
  });

  it("takes an override for one bar and never lets it cut into the body", () => {
    const bars = barsFromCloses([10, 11, 12], { 1: { h: 13, l: 9.5 }, 2: { h: 11.5 } });
    expect(bars[1][1]).toBe(13);
    expect(bars[1][2]).toBe(9.5);
    expect(bars[2][1]).toBe(12); // a high under the close is lifted to the close
  });
});

describe("priceScale", () => {
  const bars = barsFromCloses([10, 12, 11]);
  const frame = { top: 20, bottom: 120 };

  it("puts the highest high on the top edge and the lowest low on the bottom edge", () => {
    const y = priceScale(bars, frame);
    expect(y(Math.max(...bars.map((b) => b[1])))).toBeCloseTo(20);
    expect(y(Math.min(...bars.map((b) => b[2])))).toBeCloseTo(120);
    expect(y(12)).toBeLessThan(y(10)); // a higher price is drawn higher
  });

  it("widens the range for a price line outside the bars", () => {
    const y = priceScale(bars, frame, [20]);
    expect(y(20)).toBeCloseTo(20);
    expect(y(12)).toBeGreaterThan(20);
  });
});

describe("candleX", () => {
  it("spaces the bars evenly and keeps them inside the frame", () => {
    const frame = { left: 10, right: 110 };
    expect(slotWidth(4, frame)).toBe(25);
    expect([0, 1, 2, 3].map((i) => candleX(i, 4, frame))).toEqual([22.5, 47.5, 72.5, 97.5]);
  });
});

describe("rollingMean", () => {
  it("is empty until the window is full, then the mean of the last values", () => {
    expect(rollingMean([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});
