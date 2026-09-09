import { describe, expect, it } from "vitest";
import { CONFIG } from "../lib/config";
import { buildCandidate, explainScreen, rankCandidates, screenTicker } from "../lib/screen";
import { breakoutSetup, flatBars, resetDays, trendBars } from "./fixtures";
import type { Bar, Candidate } from "../lib/types";

describe("screenTicker", () => {
  it("accepts a textbook breakout setup", () => {
    const c = screenTicker("TEST", "Test Corp", breakoutSetup());
    expect(c).not.toBeNull();
    expect(c!.ret6m).toBeGreaterThan(CONFIG.MOMENTUM.M6);
    expect(c!.adrPct).toBeGreaterThanOrEqual(CONFIG.MIN_ADR_PCT);
    expect(c!.box).not.toBeNull();
    expect(c!.bars.length).toBeLessThanOrEqual(CONFIG.CHART_BARS);
  });

  it("rejects a flat low-momentum stock (an index-fund-grade megacap)", () => {
    resetDays();
    const bars = flatBars(200, 400, 0.015, 10_000_000);
    expect(screenTicker("SLOW", "Slow Inc", bars)).toBeNull();
  });

  it("rejects sub-$10 stocks even with the dollar volume to pass", () => {
    resetDays();
    // $4 → $9 on 5M shares/day ($45M traded): momentum and volume pass, price does not.
    const bars = [...flatBars(140, 4, 0.05, 5_000_000), ...trendBars(60, 4, 9, 0.06, 5_000_000)];
    expect(screenTicker("PENNY", "Penny Co", bars)).toBeNull();
  });

  it("rejects thin dollar volume ($11M/day at $44 is under the $20M floor)", () => {
    resetDays();
    const base = flatBars(120, 20, 0.05, 250_000);
    const bars = [...base, ...trendBars(80, 20, 44, 0.06, 250_000)];
    expect(screenTicker("THIN", "Thin Co", bars)).toBeNull();
  });

  it("rejects insufficient history", () => {
    resetDays();
    expect(screenTicker("NEW", "New IPO", trendBars(60, 10, 30))).toBeNull();
  });
});

describe("rankCandidates", () => {
  it("sorts tightest first and caps at MAX_RESULTS", () => {
    const mk = (t: string, tight: number): Candidate => ({
      ticker: t, name: t, price: 10, dollarVol: 2e6,
      ret1m: 0.3, ret3m: 0.6, ret6m: 1.2, adrPct: 4,
      distFromHigh: 0.05, tightness: tight, box: null, pivot: null, ep: null, bars: [],
    });
    const many = Array.from({ length: 100 }, (_, i) => mk(`T${i}`, 100 - i));
    const ranked = rankCandidates(many);
    expect(ranked.length).toBe(CONFIG.MAX_RESULTS);
    expect(ranked[0].tightness).toBeLessThan(ranked[1].tightness);
  });
});

describe("parabolic guard and ranking", () => {
  function pump(): Bar[] {
    const bars: Bar[] = [];
    for (let i = 0; i < 120; i++) bars.push({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, o: 1, h: 1.05, l: 0.97, c: 1 + (i % 3) * 0.01, v: 50_000 });
    [5.6, 4.0, 6.2, 7.2, 10.6, 11.0, 11.8, 14.8, 17.0, 18.2].forEach((c, i) =>
      bars.push({ date: `2026-08-${String(10 + i).padStart(2, "0")}`, o: c * 0.8, h: c * 1.1, l: c * 0.72, c, v: 20_000_000 }),
    );
    return bars;
  }
  it("rejects a $1 shell that spiked to $18 even though today's numbers pass every floor", () => {
    const c = buildCandidate("PUMP", "Pump", pump())!;
    expect(c.price).toBeGreaterThan(CONFIG.MIN_PRICE);
    expect(c.adrPct).toBeGreaterThan(CONFIG.MAX_ADR_PCT);
    expect(screenTicker("PUMP", "Pump", pump())).toBeNull();
  });
  it("ranks boxed setups ahead of tighter no-box names", () => {
    resetDays();
    const boxed = screenTicker("BOX", "Boxed", breakoutSetup())!;
    expect(boxed.box).not.toBeNull();
    const noBox = { ...boxed, ticker: "NOBOX", box: null, tightness: boxed.tightness / 2 };
    const ranked = rankCandidates([noBox, boxed]);
    expect(ranked.map((c) => c.ticker)).toEqual(["BOX", "NOBOX"]);
  });
});

describe("explainScreen", () => {
  it("agrees with screenTicker and names the failing rule", () => {
    resetDays();
    const good = breakoutSetup();
    const c = buildCandidate("GOOD", "Good", good)!;
    expect(explainScreen(c, good).every((k) => k.ok)).toBe(true);
    expect(explainScreen(c, good)).toHaveLength(10);

    resetDays();
    const slow = flatBars(200, 150);
    const s = buildCandidate("SLOW", "Slow", slow)!;
    const checks = explainScreen(s, slow);
    expect(checks.every((k) => k.ok)).toBe(screenTicker("SLOW", "Slow", slow) !== null);
    expect(checks.find((k) => k.label.startsWith("Momentum"))!.ok).toBe(false);
    expect(checks.find((k) => k.label.startsWith("Price ≥"))!.ok).toBe(true);
    expect(checks.find((k) => k.label.startsWith("Momentum"))!.detail).toMatch(/1M .* · 3M .* · 6M/);
  });
});
