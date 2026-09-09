import { describe, expect, it } from "vitest";
import { fetchMany, mergeLive, planFetch, provisionalBar, type CacheRow, type Quote } from "../lib/intraday";
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
