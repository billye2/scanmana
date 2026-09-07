import { describe, expect, it } from "vitest";
import { assessMarket, indexHealth } from "../lib/market";
import type { Bar } from "../lib/types";

function series(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    o: c,
    h: c * 1.01,
    l: c * 0.99,
    c,
    v: 1_000_000,
  }));
}
const up = (n = 80) => series(Array.from({ length: n }, (_, i) => 100 + i)); // steady uptrend
const down = (n = 80) => series(Array.from({ length: n }, (_, i) => 200 - i)); // steady downtrend
// Uptrend, then a shallow dip: closes below the 10-day but 10 > 20 and price above the 20/50.
const dip = () => series([...Array.from({ length: 75 }, (_, i) => 100 + i), 172, 171, 170, 170, 170]);
// Uptrend, then a sharp break: the 10-day crosses below the 20-day.
const cross = () => series([...Array.from({ length: 75 }, (_, i) => 100 + i), 150, 150, 150, 150, 150]);

describe("indexHealth", () => {
  it("needs enough bars for the longest average plus slope lookback", () => {
    expect(indexHealth("QQQ", up(54))).toBeNull();
    expect(indexHealth("QQQ", up(55))).not.toBeNull();
  });
  it("marks every average above and rising in an uptrend", () => {
    const h = indexHealth("QQQ", up())!;
    expect(h.smas.map((s) => s.period)).toEqual([10, 20, 50]);
    expect(h.smas.every((s) => s.above && s.rising)).toBe(true);
    expect(h.fastOverSlow).toBe(true);
  });
});

describe("assessMarket", () => {
  it("is bullish when both leaders are above rising averages", () => {
    const m = assessMarket(new Map([["QQQ", up()], ["SPY", up()], ["IWM", down()]]))!;
    expect(m.verdict).toBe("bullish");
    expect(m.indices.map((i) => i.ticker)).toEqual(["QQQ", "SPY", "IWM"]);
  });
  it("is not bullish when a leader is in a downtrend, even if the other is fine", () => {
    const m = assessMarket(new Map([["QQQ", up()], ["SPY", down()]]))!;
    expect(m.verdict).toBe("not-bullish");
    expect(m.reason).toMatch(/SPY 10d below 20d/);
    expect(m.reason).toMatch(/SPY below 20d/);
  });
  it("stays bullish on a shallow dip under the 10-day while 10 > 20 and price holds the 20", () => {
    const m = assessMarket(new Map([["QQQ", dip()], ["SPY", up()]]))!;
    expect(m.indices[0].fastOverSlow).toBe(true);
    expect(m.verdict).toBe("bullish");
  });
  it("is not bullish once the 10-day crosses under the 20-day", () => {
    const m = assessMarket(new Map([["QQQ", cross()], ["SPY", up()]]))!;
    expect(m.indices[0].fastOverSlow).toBe(false);
    expect(m.verdict).toBe("not-bullish");
    expect(m.reason).toMatch(/QQQ 10d below 20d/);
  });
  it("ignores non-leader indexes for the verdict and returns null without leaders", () => {
    expect(assessMarket(new Map([["IWM", down()]]))).toBeNull();
  });
});
