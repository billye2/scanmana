import { describe, expect, it } from "vitest";
import { buildLiveRows, classifyWatch, inMarketHours, toLiveEntries } from "../lib/livewatch";
import type { CachedQuote, Quote } from "../lib/intraday";
import type { Candidate } from "../lib/types";

const q = (c: number, pc = 10, o = 10, h = 12, l = 9): Quote => ({ c, pc, o, h, l, t: 0 });

describe("classifyWatch", () => {
  it("buckets by trigger and stop", () => {
    expect(classifyWatch(q(10.6), 10.5, 9.5)).toBe("breaking"); // above trigger now
    expect(classifyWatch(q(10.2, 10.8), 10.5, 9.5)).toBe("failed"); // closed above yesterday, back inside
    expect(classifyWatch(q(9.2), 10.5, 9.5)).toBe("stopped"); // under the stop
    expect(classifyWatch(q(10.35), 10.5, 9.5)).toBe("approaching"); // within 2%
    expect(classifyWatch(q(9.8), 10.5, 9.5)).toBe("quiet");
    expect(classifyWatch(q(10.6), null, null)).toBe("quiet"); // no box saved
  });
});

describe("inMarketHours", () => {
  it("knows a Wednesday noon ET from a Saturday and a midnight", () => {
    expect(inMarketHours(new Date("2026-09-02T16:00:00Z"))).toBe(true); // Wed 12:00 ET
    expect(inMarketHours(new Date("2026-09-05T16:00:00Z"))).toBe(false); // Saturday
    expect(inMarketHours(new Date("2026-09-02T04:00:00Z"))).toBe(false); // Wed 00:00 ET
  });
});

const cand = (over: Partial<Candidate>): Candidate => ({
  ticker: "X", name: "X Corp", price: 10, dollarVol: 5e7, ret1m: 0.3, ret3m: 0.6, ret6m: 1.2, adrPct: 4,
  distFromHigh: 0.05, tightness: 1, box: null, pivot: null, ep: null, bars: [], ...over,
});

describe("toLiveEntries", () => {
  it("uses the box top, else the bare pivot, as the trigger — the same rule as ☆ Watch", () => {
    const boxed = cand({ ticker: "BOX", box: { top: 21, bottom: 19, startDate: "2026-08-01", confirmed: true }, pivot: 22, verdict: "wait" });
    const pivotOnly = cand({ ticker: "PIV", pivot: 30 });
    const bare = cand({ ticker: "BARE" });
    expect(toLiveEntries([boxed, pivotOnly, bare])).toEqual([
      { ticker: "BOX", boxTop: 21, boxBottom: 19, name: "X Corp", verdict: "wait" },
      { ticker: "PIV", boxTop: 30, boxBottom: null, name: "X Corp", verdict: undefined },
      { ticker: "BARE", boxTop: null, boxBottom: null, name: "X Corp", verdict: undefined },
    ]);
  });
});

describe("buildLiveRows", () => {
  const now = 1_000_000_000;
  const cq = (c: number, ageSec = 0, pc = 10): CachedQuote => ({ ...q(c, pc), fetchedAt: now - ageSec * 1000 });

  it("sorts by bucket, keeps deck order inside a bucket, drops names without a quote, carries the quote age", () => {
    const entries = [
      { ticker: "Q1", boxTop: 20, boxBottom: 5 }, // quiet (well under the trigger, above the stop)
      { ticker: "B1", boxTop: 10.5, boxBottom: 9.5, name: "Break One", verdict: "wait" as const }, // breaking
      { ticker: "A1", boxTop: 10.2, boxBottom: 9 }, // approaching
      { ticker: "NOQ", boxTop: 10, boxBottom: 9 }, // no quote
      { ticker: "B2", boxTop: 10.5, boxBottom: 9.5 }, // breaking, after B1
    ];
    const quotes = new Map<string, CachedQuote>([
      ["Q1", cq(10)],
      ["B1", cq(10.6, 90)],
      ["A1", cq(10.05)],
      ["B2", cq(10.7)],
    ]);
    const rows = buildLiveRows(entries, quotes, now);
    expect(rows.map((r) => r.ticker)).toEqual(["B1", "B2", "A1", "Q1"]);
    expect(rows[0]).toMatchObject({ status: "breaking", price: 10.6, ageSec: 90, name: "Break One", verdict: "wait" });
    expect(rows[0].toTriggerPct).toBeLessThan(0); // above the trigger
    expect(rows[2].toTriggerPct).toBeCloseTo(10.2 / 10.05 - 1, 6);
  });
});
