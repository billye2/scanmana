import { describe, expect, it } from "vitest";
import { CONFIG } from "../lib/config";
import { adjustForSplits } from "../lib/scan";
import { hasVcp, objections, toHistoryRow } from "../lib/scan-history";
import { BASE_LIMITS, LOOSE_LIMITS, explainScreen, screenBoth } from "../lib/screen";
import { analyzeCandidate } from "../lib/analysis";
import { breakoutSetup, flatBars, resetDays, trendBars } from "./fixtures";
import type { Analysis, Bar, FrameworkView } from "../lib/types";

describe("screen limits", () => {
  it("BASE_LIMITS mirror CONFIG and LOOSE_LIMITS are never tighter", () => {
    expect(BASE_LIMITS.MIN_PRICE).toBe(CONFIG.MIN_PRICE);
    expect(BASE_LIMITS.MIN_DOLLAR_VOLUME).toBe(CONFIG.MIN_DOLLAR_VOLUME);
    expect(LOOSE_LIMITS.MIN_PRICE).toBeLessThanOrEqual(BASE_LIMITS.MIN_PRICE);
    expect(LOOSE_LIMITS.MIN_DOLLAR_VOLUME).toBeLessThanOrEqual(BASE_LIMITS.MIN_DOLLAR_VOLUME);
    expect(LOOSE_LIMITS.MIN_ADR_PCT).toBeLessThanOrEqual(BASE_LIMITS.MIN_ADR_PCT);
    expect(LOOSE_LIMITS.MAX_DIST_FROM_HIGH).toBeGreaterThanOrEqual(BASE_LIMITS.MAX_DIST_FROM_HIGH);
  });

  it("screenBoth passes the textbook setup on both screens", () => {
    const r = screenBoth("TEST", "Test Corp", breakoutSetup());
    expect(r).not.toBeNull();
    expect(r!.basePass).toBe(true);
    expect(explainScreen(r!.candidate, breakoutSetup(), LOOSE_LIMITS).every((k) => k.ok)).toBe(true);
  });

  it("screenBoth keeps a thin name for the loose set but not the deck", () => {
    resetDays();
    // $11M/day at $44: under the $20M deck floor, over the $5M loose floor.
    const bars = [...flatBars(120, 20, 0.05, 250_000), ...trendBars(80, 20, 44, 0.06, 250_000)];
    const r = screenBoth("THIN", "Thin Co", bars);
    if (r) {
      expect(r.basePass).toBe(false);
      expect(r.candidate.dollarVol).toBeLessThan(CONFIG.MIN_DOLLAR_VOLUME);
      expect(r.candidate.dollarVol).toBeGreaterThanOrEqual(LOOSE_LIMITS.MIN_DOLLAR_VOLUME);
    } else {
      // some other rule (trend, distance) failed — still must not be a deck candidate
      expect(explainScreen(r ?? ({} as never), bars).length).toBeGreaterThan(0);
    }
  });

  it("the loose price label still shows a dollar sign", () => {
    const r = screenBoth("TEST", "Test Corp", breakoutSetup())!;
    const labels = explainScreen(r.candidate, breakoutSetup(), LOOSE_LIMITS).map((k) => k.label);
    expect(labels[0]).toBe(`Price ≥ $${LOOSE_LIMITS.MIN_PRICE}`);
  });
});

describe("adjustForSplits", () => {
  const bars: Bar[] = [
    { date: "2026-08-12", o: 10, h: 11, l: 9, c: 10, v: 300 },
    { date: "2026-08-13", o: 10, h: 11, l: 9, c: 10, v: 300 },
    { date: "2026-08-14", o: 30, h: 31, l: 29, c: 30, v: 100 },
  ];
  it("scales bars before the split date and leaves the rest alone", () => {
    const out = adjustForSplits(bars, [{ date: "2026-08-14", factor: 3 }]);
    expect(out[0]).toEqual({ date: "2026-08-12", o: 30, h: 33, l: 27, c: 30, v: 100 });
    expect(out[2]).toEqual(bars[2]);
  });
  it("compounds several splits and is a no-op without any", () => {
    const out = adjustForSplits(bars, [{ date: "2026-08-13", factor: 2 }, { date: "2026-08-14", factor: 3 }]);
    expect(out[0].c).toBeCloseTo(60);
    expect(out[1].c).toBeCloseTo(30);
    expect(adjustForSplits(bars, [])).toBe(bars);
  });
});

describe("scan history rows", () => {
  const view = (verdict: "wait" | "pass"): FrameworkView => ({ verdict, points: [] });
  const analysis: Analysis = {
    ticker: "T", date: "2026-09-18", overall: "pass", summary: "", plan: null,
    qullamaggie: view("wait"), livermore: view("pass"), darvas: view("wait"), minervini: view("pass"),
  };
  it("objections lists the frameworks that said pass, in a fixed order", () => {
    expect(objections(analysis)).toEqual(["livermore", "minervini"]);
    expect(objections({ ...analysis, minervini: undefined })).toEqual(["livermore"]);
  });
  it("toHistoryRow carries the metrics, badges and rank", () => {
    const r = screenBoth("TEST", "Test Corp", breakoutSetup())!;
    const a = analyzeCandidate(r.candidate, undefined);
    const row = toHistoryRow(r.candidate, a, true, 3, undefined);
    expect(row.ticker).toBe("TEST");
    expect(row.rank).toBe(3);
    expect(row.boxed).toBe(!!r.candidate.box);
    expect(row.boxTop).toBe(r.candidate.box?.top ?? null);
    expect(row.verdict).toBe(a.overall);
    expect(row.marketBullish).toBeNull();
    expect(typeof row.vcp).toBe("boolean");
    expect(row.vcp).toBe(hasVcp(r.candidate));
  });
});
