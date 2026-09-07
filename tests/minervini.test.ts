import { describe, expect, it } from "vitest";
import { analyzeCandidate } from "../lib/analysis";
import { explainVcp, readVcp } from "../lib/minervini";
import { buildCandidate } from "../lib/screen";
import { bar, breakoutSetup, flatBars, resetDays, trendBars } from "./fixtures";
import type { Bar } from "../lib/types";

/** Uptrend, then three progressively shallower pullbacks (~18% → ~9% → ~4%), tight at the right edge. */
function vcpBars(): Bar[] {
  resetDays();
  const bars = trendBars(110, 20, 50, 0.04); // prior move (long enough for MIN_BARS with the waves)
  const wave = (from: number, downTo: number, len: number, vol: number) => {
    for (let i = 0; i < len; i++) {
      const t = i / (len - 1);
      const p = from + (downTo - from) * Math.min(1, t * 2) + (t > 0.5 ? (from - downTo) * (t - 0.5) * 1.6 : 0);
      bars.push(bar(p, p * 1.012, p * 0.988, p, vol));
    }
  };
  wave(50, 41, 12, 900_000); // ~18% pullback, recovers
  wave(50, 45.5, 10, 700_000); // ~9%
  wave(50, 48, 8, 400_000); // ~4%, volume drying up
  return bars;
}

describe("readVcp", () => {
  it("finds progressively shrinking contractions in a textbook VCP", () => {
    const v = readVcp(vcpBars())!;
    expect(v.contractions.length).toBeGreaterThanOrEqual(2);
    expect(v.shrinking).toBe(true);
    const last = v.contractions[v.contractions.length - 1];
    expect(last).toBeLessThan(v.contractions[0]);
    expect(last).toBeLessThanOrEqual(0.1);
  });

  it("does not call a flat drift a shrinking VCP", () => {
    resetDays();
    const v = readVcp(flatBars(80, 30, 0.2));
    expect(v === null || !v.shrinking).toBe(true);
  });
});

describe("minervini framework view", () => {
  it("is present, wait-or-pass, and reads a VCP setup as wait", () => {
    resetDays();
    const bars = vcpBars();
    const c = buildCandidate("VCP", "Vcp Corp", bars)!;
    const a = analyzeCandidate(c, undefined);
    expect(a.minervini).toBeDefined();
    expect(["wait", "pass"]).toContain(a.minervini!.verdict);
    expect(a.minervini!.points.join(" ")).toMatch(/contraction/i);
  });

  it("passes a base whose right side is wider than its left", () => {
    resetDays();
    // expanding: shallow pullback first, deep one at the right edge
    const bars = trendBars(110, 20, 50, 0.04);
    const push = (from: number, downTo: number, len: number) => {
      for (let i = 0; i < len; i++) {
        const t = i / (len - 1);
        const p = from + (downTo - from) * Math.min(1, t * 2) + (t > 0.5 ? (from - downTo) * (t - 0.5) * 1.6 : 0);
        bars.push(bar(p, p * 1.012, p * 0.988, p, 800_000));
      }
    };
    push(50, 48, 8); // ~4%
    push(50, 40, 14); // ~20% — expanding
    const c = buildCandidate("EXP", "Expanding", bars)!;
    const a = analyzeCandidate(c, undefined);
    expect(a.minervini!.verdict).toBe("pass");
  });

  it("keeps working on the standard breakout fixture", () => {
    resetDays();
    const c = buildCandidate("GOOD", "Good", breakoutSetup())!;
    const a = analyzeCandidate(c, undefined);
    expect(a.minervini).toBeDefined();
  });
});

describe("explainVcp", () => {
  it("marks the textbook VCP conditions ok and names the sequence", () => {
    const checks = explainVcp(vcpBars());
    const by = (start: string) => checks.find((k) => k.label.startsWith(start))!;
    expect(by("At least").ok).toBe(true);
    expect(by("Contractions progressively").ok).toBe(true);
    expect(by("Contractions progressively").detail).toMatch(/% → /);
    expect(by("Final contraction").ok).toBe(true);
    expect(by("Holding above").ok).toBe(true);
  });

  it("reports no sequence for a too-short tape instead of throwing", () => {
    resetDays();
    const checks = explainVcp(flatBars(4, 30)); // below the swing window
    expect(checks.length).toBe(1);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toMatch(/no pullback sequence/);
  });
});
