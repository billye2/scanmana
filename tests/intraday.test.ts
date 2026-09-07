import { describe, expect, it } from "vitest";
import { mergeLive, provisionalBar, type Quote } from "../lib/intraday";
import { flatBars, resetDays } from "./fixtures";

const q = (over: Partial<Quote> = {}): Quote => ({ c: 105, o: 101, h: 106, l: 100, pc: 100, t: 1_800_000_000, ...over });

describe("provisionalBar", () => {
  it("builds today's bar with the 20-day average volume (finnhub quotes carry none)", () => {
    resetDays();
    const prior = flatBars(30, 100, 0.02, 500_000);
    const bar = provisionalBar(q(), prior, "2026-09-02")!;
    expect(bar).toMatchObject({ date: "2026-09-02", o: 101, c: 105 });
    expect(bar.h).toBeGreaterThanOrEqual(105); // high can never be under the current price
    expect(bar.v).toBe(500_000);
  });

  it("rejects empty quotes and weekends", () => {
    resetDays();
    const prior = flatBars(30, 100);
    expect(provisionalBar(q({ c: 0 }), prior, "2026-09-02")).toBeNull();
    expect(provisionalBar(q(), prior, "2026-09-06")).toBeNull(); // a Sunday
  });
});

describe("mergeLive", () => {
  it("appends exactly one provisional bar", () => {
    resetDays();
    const prior = flatBars(30, 100);
    const merged = mergeLive(prior, q(), "2027-01-04");
    expect(merged.length).toBe(prior.length + 1);
    expect(merged[merged.length - 1].c).toBe(105);
  });

  it("leaves history alone when it already covers today", () => {
    resetDays();
    const prior = flatBars(30, 100);
    const today = prior[prior.length - 1].date;
    expect(mergeLive(prior, q(), today)).toBe(prior);
  });
});
