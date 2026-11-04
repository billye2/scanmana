import { describe, expect, it } from "vitest";
import type { BreadthRow } from "../lib/research";
import { tapeSentence, tapeWindow, verdictStreak } from "../lib/tape-read";

const row = (date: string, bullish: boolean | null, pct = 0.5, highs = 10, lows = 5): BreadthRow => ({
  date,
  universe: 1000,
  pctAbove20: pct,
  pctAbove50: null,
  pct10Over20: 0.5,
  newHighs: highs,
  newLows: lows,
  marketBullish: bullish,
});
const days = (n: number, f: (i: number) => BreadthRow) => Array.from({ length: n }, (_, i) => f(i));
const d = (i: number) => `2026-10-${String(i + 1).padStart(2, "0")}`;

describe("verdictStreak — how long the index verdict has held", () => {
  it("counts back from the newest row while the verdict is the same", () => {
    const rows = [row(d(0), true), row(d(1), true), row(d(2), false), row(d(3), false), row(d(4), false)];
    expect(verdictStreak(rows)).toEqual({ bullish: false, sessions: 3, since: d(2) });
  });

  it("skips trailing rows without a verdict and stops at the first unknown", () => {
    const rows = [row(d(0), null), row(d(1), true), row(d(2), true), row(d(3), null)];
    expect(verdictStreak(rows)).toEqual({ bullish: true, sessions: 2, since: d(1) });
    expect(verdictStreak([row(d(0), null)])).toEqual({ bullish: null, sessions: 0, since: null });
    expect(verdictStreak([])).toEqual({ bullish: null, sessions: 0, since: null });
  });
});

describe("tapeWindow — the window's shape", () => {
  it("takes the Bullish share, the longest run, breadth now against ten sessions ago, and highs over lows", () => {
    const rows = days(12, (i) => row(d(i), i >= 2 && i <= 5, 0.4 + i * 0.01, i % 2 ? 12 : 3, 8));
    const w = tapeWindow(rows);
    expect(w.sessions).toBe(12);
    expect(w.bullishShare).toBeCloseTo(4 / 12);
    expect(w.longestBullish).toBe(4);
    expect(w.breadthNow).toBeCloseTo(0.51);
    expect(w.breadthTenAgo).toBeCloseTo(0.41);
    expect(w.highsOverLowsShare).toBe(0.5);
  });

  it("leaves what it cannot know as null", () => {
    expect(tapeWindow([])).toEqual({ sessions: 0, bullishShare: null, longestBullish: 0, breadthNow: null, breadthTenAgo: null, highsOverLowsShare: null });
    expect(tapeWindow([row(d(0), null, 0.5, 0, 0)]).bullishShare).toBeNull();
    expect(tapeWindow(days(5, (i) => row(d(i), true))).breadthTenAgo).toBeNull();
  });
});

describe("tapeSentence — the page's first line", () => {
  it("reads the streak, the breadth move, the Bullish share and the size", () => {
    const rows = days(12, (i) => row(d(i), i >= 9, 0.4 + i * 0.01));
    const s = tapeSentence(verdictStreak(rows), tapeWindow(rows), { label: "full", reason: "index Bullish, breadth 51%" });
    expect(s).toBe(
      "Bullish for 3 sessions (since 2026-10-10) · breadth 51% above the 20-day, up from 41% ten sessions ago · Bullish on 25% of the last 12 sessions (longest run 3) · the book sizes at full size (index Bullish, breadth 51%)",
    );
  });

  it("says when there is no verdict and when breadth is flat", () => {
    const rows = days(12, (i) => row(d(i), null, 0.5));
    expect(tapeSentence(verdictStreak(rows), tapeWindow(rows), { label: "half", reason: "breadth 50%" })).toBe(
      "No index verdict yet · breadth 50% above the 20-day, flat over ten sessions · the book sizes at half size (breadth 50%)",
    );
  });
});
