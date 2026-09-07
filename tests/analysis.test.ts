import { describe, expect, it } from "vitest";
import { analyzeCandidate } from "../lib/analysis";
import { buildCandidate, screenTicker } from "../lib/screen";
import type { Bar, MarketHealth } from "../lib/types";
import { breakoutSetup, resetDays } from "./fixtures";

const bullish: MarketHealth = { verdict: "bullish", reason: "ok", indices: [] };
const notBullish: MarketHealth = { verdict: "not-bullish", reason: "QQQ 10d below 20d — x", indices: [] };

function parabolic(): Bar[] {
  // $1 for 120 days, then a 10-session spike to $9 with huge volume and 50% daily ranges.
  const bars: Bar[] = [];
  for (let i = 0; i < 120; i++) bars.push({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, o: 1, h: 1.05, l: 0.97, c: 1 + (i % 3) * 0.01, v: 50_000 });
  const path = [2.8, 2.0, 3.1, 3.6, 5.3, 5.5, 5.9, 7.4, 8.5, 9.1];
  path.forEach((c, i) => bars.push({ date: `2026-08-${String(10 + i).padStart(2, "0")}`, o: c * 0.8, h: c * 1.1, l: c * 0.72, c, v: 20_000_000 }));
  return bars;
}

describe("analyzeCandidate", () => {
  it("passes on a parabolic spike under all three frameworks", () => {
    // The screen now rejects this outright; the symbol page can still build the card.
    expect(screenTicker("PUMP", "Pump Inc", parabolic())).toBeNull();
    const c = buildCandidate("PUMP", "Pump Inc", parabolic());
    expect(c).not.toBeNull();
    const a = analyzeCandidate(c!, bullish);
    expect(a.overall).toBe("pass");
    expect(a.qullamaggie.verdict).toBe("pass");
    expect(a.qullamaggie.points.join(" ")).toMatch(/vertical leg/);
    expect(a.darvas.verdict).toBe("pass");
    expect(a.plan).toBeNull();
  });

  it("waits on a clean box below the trigger, with a plan", () => {
    resetDays();
    const c = screenTicker("GOOD", "Good Co", breakoutSetup());
    expect(c).not.toBeNull();
    expect(c!.box).not.toBeNull();
    const a = analyzeCandidate(c!, bullish);
    expect(a.overall).toBe("wait");
    expect(a.darvas.verdict).toBe("wait");
    expect(a.plan).toMatch(/^Buy stop \$.* · stop \$.* \(box bottom, \d+% risk\) or the breakout day/);
    expect(a.qullamaggie.points.join(" ")).toMatch(/Market filter: on/);
  });

  it("only ever returns wait or pass — EOD data cannot justify a take", () => {
    resetDays();
    const c = screenTicker("GOOD", "Good Co", breakoutSetup())!;
    for (const m of [bullish, notBullish]) {
      const a = analyzeCandidate(c, m);
      for (const v of [a.overall, a.qullamaggie.verdict, a.livermore.verdict, a.darvas.verdict, a.minervini!.verdict]) expect(["wait", "pass"]).toContain(v);
    }
    const a = analyzeCandidate(c, notBullish);
    expect(a.qullamaggie.verdict).toBe("wait");
    expect(a.qullamaggie.points.join(" ")).toMatch(/Market filter: off/);
  });
});
