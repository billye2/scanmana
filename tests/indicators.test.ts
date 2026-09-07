import { describe, expect, it } from "vitest";
import {
  adrPct,
  avgDollarVolume,
  detectEp,
  distFromHigh,
  pctReturn,
  sma,
  smaRising,
  tightness,
} from "../lib/indicators";
import { bar, flatBars, resetDays, trendBars } from "./fixtures";

describe("pctReturn", () => {
  it("computes fractional return over the lookback", () => {
    resetDays();
    const bars = trendBars(30, 100, 200);
    const r = pctReturn(bars, 29);
    expect(r).not.toBeNull();
    // first close ≈ 103.33 → last 200
    expect(r!).toBeCloseTo(200 / (100 + 100 / 30) - 1, 2);
  });
  it("returns null with insufficient history", () => {
    resetDays();
    expect(pctReturn(flatBars(10, 50), 21)).toBeNull();
  });
});

describe("adrPct", () => {
  it("matches the constructed daily range", () => {
    resetDays();
    // rangePct 0.04 → h/l = 1.02/0.98 → ADR% ≈ 4.08
    const bars = flatBars(20, 100, 0.04);
    expect(adrPct(bars, 20)!).toBeCloseTo((1.02 / 0.98 - 1) * 100, 5);
  });
});

describe("sma / smaRising", () => {
  it("computes the mean of closes", () => {
    resetDays();
    const bars = flatBars(10, 50);
    expect(sma(bars, 10)!).toBeCloseTo(50, 10);
  });
  it("detects a rising average in an uptrend and not in a flat", () => {
    resetDays();
    expect(smaRising(trendBars(40, 100, 150), 10, 5)).toBe(true);
    resetDays();
    expect(smaRising(flatBars(40, 100), 10, 5)).toBe(false);
  });
});

describe("distFromHigh", () => {
  it("is 0 when closing at the high, positive when below", () => {
    resetDays();
    const bars = [...trendBars(50, 100, 200, 0)];
    expect(distFromHigh(bars, 50)!).toBeCloseTo(0, 5);
    resetDays();
    const pulledBack = [...trendBars(50, 100, 200, 0), bar(200, 200, 180, 180)];
    expect(distFromHigh(pulledBack, 51)!).toBeCloseTo(0.1, 5);
  });
});

describe("tightness", () => {
  it("is lower for tighter ranges", () => {
    resetDays();
    const tight = flatBars(30, 100, 0.02);
    resetDays();
    const loose = flatBars(30, 100, 0.1);
    const tAdr = 4;
    expect(tightness(tight, 10, tAdr)!).toBeLessThan(tightness(loose, 10, tAdr)!);
  });
});

describe("avgDollarVolume", () => {
  it("multiplies close by volume", () => {
    resetDays();
    const bars = flatBars(20, 10, 0.04, 500_000);
    expect(avgDollarVolume(bars, 20)!).toBeCloseTo(5_000_000, 0);
  });
});

describe("detectEp", () => {
  it("finds a 10%+ gap on 3x volume within the lookback", () => {
    resetDays();
    const bars = [...flatBars(30, 100, 0.02, 1_000_000), bar(115, 120, 112, 118, 5_000_000)];
    const ep = detectEp(bars, { LOOKBACK: 5, MIN_GAP: 0.1, VOL_MULT: 3, VOL_WINDOW: 20 });
    expect(ep).not.toBeNull();
    expect(ep!.gapPct).toBeCloseTo(0.15, 5);
    expect(ep!.volMult).toBeCloseTo(5, 5);
  });
  it("ignores gaps on normal volume", () => {
    resetDays();
    const bars = [...flatBars(30, 100, 0.02, 1_000_000), bar(115, 120, 112, 118, 1_200_000)];
    expect(detectEp(bars, { LOOKBACK: 5, MIN_GAP: 0.1, VOL_MULT: 3, VOL_WINDOW: 20 })).toBeNull();
  });
});
