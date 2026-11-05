import { describe, expect, it } from "vitest";
import { fetchMany, formatAsOf, mergeIndexQuotes, mergeLive, planFetch, provisionalBar, type CacheRow, type Quote } from "../lib/intraday";
import { indexHealth } from "../lib/market";
import { flatBars, resetDays } from "./fixtures";

const q = (over: Partial<Quote> = {}): Quote => ({ c: 105, o: 101, h: 106, l: 100, pc: 100, t: 1_800_000_000, ...over });

describe("formatAsOf", () => {
  it("renders the quote's time in Eastern", () => {
    expect(formatAsOf(1_800_000_000)).toBe("3:00 AM ET"); // 2027-01-15 08:00 UTC
  });
  it("falls back to now when the quote carries no time", () => {
    expect(formatAsOf(0, 1_800_000_000_000)).toBe("3:00 AM ET");
  });
});

describe("mergeIndexQuotes (the Help page's live index charts, 1.8.2)", () => {
  it("appends today's bar to every index that has a quote and recomputes its health from it", () => {
    resetDays();
    const stored = new Map([
      ["QQQ", flatBars(80, 100)],
      ["SPY", flatBars(80, 200)],
    ]);
    const quotes = new Map([
      ["QQQ", q({ c: 108, o: 101, h: 109, l: 100 })],
      ["SPY", q({ c: 210, o: 201, h: 211, l: 200 })],
    ]);
    const { bars, provisional } = mergeIndexQuotes(stored, quotes, "2027-06-14");
    expect(provisional).toBe(true);
    expect(bars.get("QQQ")!.length).toBe(81);
    expect(bars.get("QQQ")![80]).toMatchObject({ date: "2027-06-14", c: 108 });
    expect(indexHealth("QQQ", bars.get("QQQ")!)!.close).toBe(108);
    expect(indexHealth("SPY", bars.get("SPY")!)!.close).toBe(210);
  });

  it("keeps the stored history for an index with no quote", () => {
    resetDays();
    const stored = new Map([
      ["QQQ", flatBars(80, 100)],
      ["SPY", flatBars(80, 200)],
    ]);
    const { bars, provisional } = mergeIndexQuotes(stored, new Map([["QQQ", q()]]), "2027-06-14");
    expect(provisional).toBe(true);
    expect(bars.get("SPY")).toBe(stored.get("SPY"));
    expect(bars.get("QQQ")!.length).toBe(81);
  });

  it("is not provisional once the nightly scan has stored today", () => {
    resetDays();
    const qqq = flatBars(80, 100);
    const today = qqq[qqq.length - 1].date;
    const { bars, provisional } = mergeIndexQuotes(new Map([["QQQ", qqq]]), new Map([["QQQ", q()]]), today);
    expect(provisional).toBe(false);
    expect(bars.get("QQQ")).toBe(qqq);
  });
});

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

describe("planFetch (per-poll call budget)", () => {
  const now = 1_000_000;
  const row = (symbol: string, ageMs: number): CacheRow => ({ symbol, payload: q(), fetchedAt: now - ageMs });

  it("serves fresh rows, refetches the never-seen first, then the oldest, up to the budget", () => {
    const rows = [row("FRESH", 10_000), row("OLD", 200_000), row("OLDER", 400_000), row("OLDEST", 900_000)];
    const plan = planFetch(["FRESH", "OLD", "NEW", "OLDER", "OLDEST"], rows, 60_000, now, 2);
    expect([...plan.fresh.keys()]).toEqual(["FRESH"]);
    expect(plan.toFetch).toEqual(["NEW", "OLDEST"]); // never fetched beats stale; then oldest stale
    expect([...plan.stale.keys()].sort()).toEqual(["OLD", "OLDER", "OLDEST"]); // served old if not refetched
    expect(plan.stale.get("OLD")!.fetchedAt).toBe(now - 200_000);
  });

  it("with no budget pressure fetches every stale symbol and nothing fresh", () => {
    const rows = [row("A", 1_000), row("B", 100_000)];
    const plan = planFetch(["A", "B", "C"], rows, 60_000, now, 100);
    expect(plan.toFetch).toEqual(["C", "B"]);
    expect(plan.fresh.has("A")).toBe(true);
  });
});

describe("fetchMany (bounded, per-symbol failure, 429 halt)", () => {
  it("drops only the failing symbol", async () => {
    const fetcher = async (s: string) => {
      if (s === "BAD") throw new Error("no quote for BAD");
      return q({ c: s.length });
    };
    const { got, halted } = await fetchMany(["A", "BAD", "CC"], fetcher, 2);
    expect([...got.keys()]).toEqual(["A", "CC"]);
    expect(halted).toBe(false);
  });

  it("stops after the batch that hit the rate limit and keeps what it got", async () => {
    const calls: string[] = [];
    const fetcher = async (s: string) => {
      calls.push(s);
      if (s === "B") throw new Error("finnhub 429");
      return q();
    };
    const { got, halted } = await fetchMany(["A", "B", "C", "D", "E"], fetcher, 2);
    expect(halted).toBe(true);
    expect(calls).toEqual(["A", "B"]); // batch 2 (C, D) and 3 (E) never attempted
    expect([...got.keys()]).toEqual(["A"]);
  });
});
