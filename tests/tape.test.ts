import { describe, expect, it } from "vitest";
import { CONFIG } from "../lib/config";
import { processSession, sizeShares } from "../lib/paper-engine";
import { tapeMultiplier } from "../lib/tape";
import type { Bar } from "../lib/types";

const T = CONFIG.PAPER.TAPE;

describe("tapeMultiplier", () => {
  it("is full when both signals hold, half with one, quarter with none", () => {
    expect(tapeMultiplier(true, 0.6).label).toBe("full");
    expect(tapeMultiplier(true, 0.6).mult).toBe(1);
    expect(tapeMultiplier(true, 0.3)).toMatchObject({ label: "half", mult: T.ONE_SIGNAL });
    expect(tapeMultiplier(false, 0.7)).toMatchObject({ label: "half", mult: T.ONE_SIGNAL });
    expect(tapeMultiplier(false, 0.2)).toMatchObject({ label: "quarter", mult: T.NO_SIGNAL });
  });

  it("treats the breadth floor as inclusive", () => {
    expect(tapeMultiplier(true, T.BREADTH_MIN).label).toBe("full");
  });

  it("leaves an unknown signal out rather than counting it against the trade", () => {
    expect(tapeMultiplier(true, null).label).toBe("full");
    expect(tapeMultiplier(false, null).label).toBe("quarter");
    expect(tapeMultiplier(null, 0.8).label).toBe("full");
    expect(tapeMultiplier(null, null)).toMatchObject({ label: "full", mult: 1, reason: "no tape data" });
  });

  it("explains itself", () => {
    expect(tapeMultiplier(true, 0.25).reason).toBe("index Bullish, breadth 25% (under 50%)");
  });
});

describe("sizing by the tape in the engine", () => {
  const bar: Bar = { date: "2026-09-21", o: 20, h: 21, l: 19.5, c: 20.5, v: 1_000_000 };
  /** Twelve sessions ending on `bar.date` (the engine only acts on a ticker whose last bar is the session). */
  const history = (last: Bar): Bar[] => [...Array.from({ length: 11 }, (_, i) => ({ ...last, date: `2026-09-${String(8 + i).padStart(2, "0")}` })), last];
  const bars = new Map([["X", history(bar)]]);
  const order = { id: 1, track: "auto" as const, ticker: "X", trigger: 20, stop: 18, kind: "buy_stop" as const, status: "armed" as const, late: false, armedDate: "2026-09-20", cancelledReason: null };

  it("scales the notional and records the multiplier on the fill", () => {
    expect(sizeShares(20)).toBe(25);
    expect(sizeShares(20, 0.5)).toBe(12);
    expect(sizeShares(20, 0.25)).toBe(6);
    const half = processSession({ date: bar.date, bars, orders: [order], positions: [], cash: { auto: 0, manual: 0 }, sizeMult: 0.5 });
    const fill = half.events.find((e) => e.type === "fill");
    expect(fill).toMatchObject({ type: "fill", shares: 12, sizeMult: 0.5 });
    const full = processSession({ date: bar.date, bars, orders: [order], positions: [], cash: { auto: 0, manual: 0 } });
    expect(full.events.find((e) => e.type === "fill")).toMatchObject({ shares: 25, sizeMult: 1 });
  });

  it("names the reduced notional when one share is too expensive at this size", () => {
    const dear: Bar = { ...bar, o: 300, h: 310, l: 295, c: 305 };
    const dearBars = new Map([["X", history(dear)]]);
    const r = processSession({ date: dear.date, bars: dearBars, orders: [{ ...order, trigger: 300, stop: 280 }], positions: [], cash: { auto: 0, manual: 0 }, sizeMult: 0.25 });
    expect(r.orders[0].status).toBe("cancelled");
    expect(r.orders[0].cancelledReason).toMatch(/\$125 notional at this tape size/);
  });
});
