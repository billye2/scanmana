import { describe, expect, it } from "vitest";
import {
  galleryBox,
  galleryFacts,
  galleryMarkers,
  gallerySentence,
  gallerySummary,
  gallerySummaryText,
  galleryWindow,
  pickGallery,
  type GalleryRow,
} from "../lib/gallery";
import type { Bar } from "../lib/types";

const row = (over: Partial<GalleryRow>): GalleryRow => ({
  date: "2026-06-10",
  ticker: "ABC",
  close: 50,
  verdict: "wait",
  boxed: true,
  boxTop: 52,
  boxBottom: 47,
  pivot: null,
  adrPct: 5.2,
  tightness: 0.9,
  distFromHigh: 0.03,
  ret1m: 0.3,
  ret3m: 0.8,
  ret6m: 1.5,
  marketBullish: true,
  mfe20: 0.42,
  mae20: -0.04,
  broke10d: true,
  brokeDay: 3,
  kR: 2.1,
  kStopAdr: 0.7,
  kEntryDay: 3,
  ...over,
});

const bars = (from: string, n: number): Bar[] => {
  const out: Bar[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), o: 50, h: 51, l: 49, c: 50, v: 1 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

describe("pickGallery — best follow-through first, one row per ticker", () => {
  it("sorts by the 20-session best close and keeps only a ticker's best night", () => {
    const rows = [
      row({ ticker: "A", date: "2026-06-01", mfe20: 0.2 }),
      row({ ticker: "A", date: "2026-06-02", mfe20: 0.5 }),
      row({ ticker: "B", date: "2026-06-01", mfe20: 0.3 }),
      row({ ticker: "C", date: "2026-06-01", mfe20: 0.1 }),
    ];
    expect(pickGallery(rows, 10).map((r) => `${r.ticker}:${r.date}`)).toEqual(["A:2026-06-02", "B:2026-06-01", "C:2026-06-01"]);
  });

  it("stops at the limit", () => {
    const rows = [row({ ticker: "A", mfe20: 0.2 }), row({ ticker: "B", mfe20: 0.3 }), row({ ticker: "C", mfe20: 0.1 })];
    expect(pickGallery(rows, 2).map((r) => r.ticker)).toEqual(["B", "A"]);
  });

  it("breaks a tie by the earlier night and leaves the input untouched", () => {
    const rows = [row({ ticker: "B", date: "2026-06-02", mfe20: 0.3 }), row({ ticker: "A", date: "2026-06-01", mfe20: 0.3 })];
    expect(pickGallery(rows, 5).map((r) => r.ticker)).toEqual(["A", "B"]);
    expect(rows[0].ticker).toBe("B");
  });
});

describe("galleryWindow / galleryBox", () => {
  it("draws 140 calendar days before the scan night and 35 after", () => {
    expect(galleryWindow("2026-06-10")).toEqual({ since: "2026-01-21", until: "2026-07-15" });
  });

  it("hands the chart the scan-night box, or nothing for an unboxed row", () => {
    expect(galleryBox(row({}))).toEqual({ top: 52, bottom: 47, startDate: "2026-06-10", confirmed: true });
    expect(galleryBox(row({ boxed: false, boxTop: null, boxBottom: null, pivot: 55 }))).toBeNull();
  });
});

describe("galleryMarkers — the scan night and the buy under the bars", () => {
  it("marks the scan night and the Auto book's buy, the open after the first close above the box", () => {
    const b = bars("2026-06-01", 30); // the scan night is index 9
    expect(galleryMarkers(row({ kEntryDay: 3 }), b)).toEqual([
      { date: "2026-06-10", text: "scan" },
      { date: "2026-06-14", text: "buy" }, // 9 + 3 + 1
    ]);
  });

  it("marks the breakout session when the row has no Auto plan", () => {
    const b = bars("2026-06-01", 30);
    expect(galleryMarkers(row({ boxed: false, kEntryDay: null, kR: null, brokeDay: 2 }), b)).toEqual([
      { date: "2026-06-10", text: "scan" },
      { date: "2026-06-12", text: "broke out" },
    ]);
  });

  it("drops a marker whose bar is not on the chart, and all of them when the scan night is missing", () => {
    expect(galleryMarkers(row({ kEntryDay: 3 }), bars("2026-06-01", 11))).toEqual([{ date: "2026-06-10", text: "scan" }]);
    expect(galleryMarkers(row({}), bars("2026-07-01", 10))).toEqual([]);
  });
});

describe("gallerySentence / galleryFacts — the card's two lines", () => {
  it("reads the move, the break day and the Auto plan's R with the stop width", () => {
    expect(gallerySentence(row({}))).toBe("+42% best close in 20 sessions · closed above its box on day 3 · Auto plan +2.10R, stop 0.7 ADR wide");
  });

  it("says when a name never broke out, and when a boxed break had no Auto trade", () => {
    expect(gallerySentence(row({ boxed: false, brokeDay: null, broke10d: false, kR: null, kStopAdr: null, kEntryDay: null }))).toBe(
      "+42% best close in 20 sessions · never closed above its level in 10 sessions",
    );
    expect(gallerySentence(row({ kR: null, kStopAdr: null, kEntryDay: null }))).toBe(
      "+42% best close in 20 sessions · closed above its box on day 3 · no Auto trade",
    );
  });

  it("lists the scan-night facts with the tape", () => {
    expect(galleryFacts(row({}))).toBe("ADR 5.2% · tightness 0.90 · 3.0% off the high · 1M +30% · 3M +80% · 6M +150% · Bullish tape");
    expect(galleryFacts(row({ marketBullish: null }))).toContain("tape unknown");
  });
});

describe("gallerySummary — what the shown setups had in common", () => {
  it("is null without rows", () => {
    expect(gallerySummary([])).toBeNull();
  });

  it("takes medians and shares over the rows, ignoring an unknown tape in the Bullish share", () => {
    const s = gallerySummary([
      row({ adrPct: 4, tightness: 0.5, distFromHigh: 0.01, ret3m: 0.6, mfe20: 0.3, marketBullish: true }),
      row({ adrPct: 6, tightness: 1.5, distFromHigh: 0.05, ret3m: 1.0, mfe20: 0.5, marketBullish: false, boxed: false, verdict: "pass", broke10d: false }),
      row({ adrPct: 8, tightness: 1.0, distFromHigh: 0.03, ret3m: 0.8, mfe20: 0.4, marketBullish: null }),
    ])!;
    expect(s.n).toBe(3);
    expect(s.medianAdr).toBe(6);
    expect(s.medianTightness).toBe(1.0);
    expect(s.medianDist).toBe(0.03);
    expect(s.medianRet3m).toBe(0.8);
    expect(s.medianMfe).toBe(0.4);
    expect(s.boxedShare).toBeCloseTo(2 / 3);
    expect(s.waitShare).toBeCloseTo(2 / 3);
    expect(s.brokeShare).toBeCloseTo(2 / 3);
    expect(s.bullishShare).toBe(0.5);
    expect(gallerySummaryText(s)).toBe(
      "3 setups, median +40% in 20 sessions · 67% boxed · 67% Wait · 67% closed above their level within 10 sessions · median ADR 6.0% · tightness 1.00 · 3.0% off the high · 3M +80% · 50% on a Bullish tape",
    );
  });

  it("takes the mean of the middle two on an even count", () => {
    expect(gallerySummary([row({ adrPct: 4 }), row({ adrPct: 8 })])!.medianAdr).toBe(6);
  });
});
