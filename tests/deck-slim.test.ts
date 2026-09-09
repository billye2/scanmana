import { describe, expect, it } from "vitest";
import { slimDeck } from "../lib/scan";
import type { Candidate } from "../lib/types";

function card(ticker: string): Candidate {
  return {
    ticker, name: ticker, price: 10, dollarVol: 1e7, ret1m: 0.1, ret3m: 0.2, ret6m: 0.3, adrPct: 4,
    distFromHigh: 0.02, tightness: 0.5, box: null, pivot: null, ep: null,
    bars: [{ date: "2026-09-08", o: 10, h: 11, l: 9, c: 10, v: 1000 }],
  };
}

describe("slimDeck", () => {
  const deck = ["A", "B", "C", "D"].map(card);

  it("keeps bars only for the kept indices and strips the rest", () => {
    const out = slimDeck(deck, [1]);
    expect(out.map((c) => Boolean(c.bars))).toEqual([false, true, false, false]);
    expect(out[0]).not.toHaveProperty("bars");
    expect(out[1].bars).toBe(deck[1].bars);
  });

  it("wraps indices around the deck like the deck's own navigation", () => {
    const out = slimDeck(deck, [-1, 0, 1]);
    expect(out.map((c) => Boolean(c.bars))).toEqual([true, true, false, true]);
  });

  it("strips everything when nothing is kept, and leaves the other fields intact", () => {
    const out = slimDeck(deck, []);
    expect(out.every((c) => !("bars" in c))).toBe(true);
    expect(out[2].ticker).toBe("C");
    expect(out[2].dollarVol).toBe(1e7);
  });

  it("is a no-op on an empty deck", () => {
    expect(slimDeck([], [0])).toEqual([]);
  });
});
