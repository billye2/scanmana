import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../lib/config";
import { defaultTakeStop, planStop, sharesForRisk, takeStopError, type StopPlan } from "../lib/stop-plan";
import type { Bar } from "../lib/types";
import { bar, flatBars, resetDays } from "./fixtures";

function plan(bars: Bar[], entry: number, extra: { entryDate?: string; shares?: number; cash?: number } = {}): StopPlan {
  const r = planStop({ bars, entry, entryDate: extra.entryDate ?? bars[bars.length - 1].date, shares: extra.shares, cash: extra.cash });
  if ("error" in r) throw new Error(r.error);
  return r;
}
const find = (p: StopPlan, key: string) => p.candidates.find((c) => c.key === key);

describe("planStop — the ladder and the recommendation", () => {
  beforeEach(resetDays);

  it("recommends the entry-day low when it is within one ADR", () => {
    const bars = flatBars(40, 100, 0.04); // lows 98, ADR ≈ 4.1%
    const p = plan(bars, 100);
    expect(p.recommended.key).toBe("entry_low");
    expect(p.recommended.price).toBeCloseTo(98, 6);
    expect(p.recommended.wide).toBe(false);
    expect(p.reason).toMatch(/low of the day you bought/);
    expect(find(p, "box_bottom")?.price).toBeCloseTo(98, 6);
  });

  it("falls to the breakout-day low when the entry-day low is wider than one ADR", () => {
    const bars = [
      ...flatBars(40, 100, 0.02), // box 99–101
      bar(103, 106, 103, 105), // closes above 101: the breakout, low 103
      bar(105, 108, 104, 107),
      bar(107, 108, 98, 106), // the shakeout session you bought
    ];
    const p = plan(bars, 105.5);
    expect(find(p, "entry_low")?.wide).toBe(true);
    expect(find(p, "box_bottom")).toBeUndefined(); // fresh highs: no box as of the entry day
    expect(p.recommended.key).toBe("breakout_low");
    expect(p.recommended.price).toBe(103);
    expect(p.reason).toMatch(/breakout-day low/);
  });

  it("keeps a wide entry-day low when nothing tighter exists and says how many shares keep the risk at 1%", () => {
    const bars = [...flatBars(40, 100, 0.02), bar(100, 101, 90, 100)];
    const p = plan(bars, 100, { cash: 10_000 });
    expect(p.recommended.key).toBe("entry_low");
    expect(p.recommended.wide).toBe(true);
    expect(p.cutSizeTo).toBe(10); // $100 of risk at $10 a share
    expect(p.reason).toMatch(/10 shares/);
  });

  it("breakout_low is the first session that closed above the pre-break box, not a later one above it", () => {
    const bars = [...flatBars(40, 100, 0.02), bar(100, 104, 100.5, 103), bar(103, 106, 102, 105)];
    const p = plan(bars, 105);
    const b = find(p, "breakout_low")!;
    expect(b.price).toBe(100.5);
    expect(b.note).toContain("101.00"); // judged against the box that was broken
  });

  it("lists no breakout_low while price is still inside the box, but does list the box bottom (the CAI shape)", () => {
    const bars = [...flatBars(40, 100, 0.04), bar(100, 101.5, 99.5, 101)];
    const p = plan(bars, 101);
    expect(find(p, "breakout_low")).toBeUndefined();
    expect(find(p, "box_bottom")?.price).toBeCloseTo(98, 6);
    expect(p.recommended.key).toBe("entry_low");
    expect(p.recommended.price).toBe(99.5);
  });

  it("never recommends an average; bought at the low of the day it falls to the one-ADR cap with a warning", () => {
    const bars = flatBars(40, 100, 0.04);
    const p = plan(bars, 98); // the day's low
    expect(find(p, "entry_low")?.usable).toBe(false);
    expect(find(p, "sma10")?.usable).toBe(false);
    expect(p.recommended.key).toBe("adr_cap");
    expect(p.recommended.price).toBeLessThan(98);
    expect(p.warnings.some((w) => /no structural level/.test(w))).toBe(true);
  });

  it("snaps a date with no session back to the previous bar and records it", () => {
    const bars = flatBars(40, 100, 0.04);
    const [gone] = bars.splice(30, 1);
    const p = plan(bars, 100, { entryDate: gone.date });
    expect(p.entryDate).toBe(bars[29].date);
    expect(p.snappedFrom).toBe(gone.date);
  });

  it("sessions after the entry day do not change the entry-day candidates", () => {
    const upTo = [...flatBars(40, 100, 0.02), bar(100, 104, 100.5, 103), bar(103, 106, 102, 105)];
    const entryDate = upTo[upTo.length - 1].date;
    const later = [...upTo, bar(105, 120, 104, 118), bar(118, 125, 90, 95)];
    const a = plan(upTo, 105, { entryDate });
    const b = plan(later, 105, { entryDate });
    for (const key of ["entry_low", "breakout_low", "box_bottom", "low10", "adr_cap"]) {
      expect(find(b, key)?.price).toBe(find(a, key)?.price);
    }
  });

  it("sizes: dollar risk and share of cash from the shares given, and the 1% share count always", () => {
    const p = plan(flatBars(40, 100, 0.04), 100, { shares: 50, cash: 10_000 });
    expect(p.recommended.dollarRisk).toBeCloseTo(100, 6);
    expect(p.recommended.pctOfCash).toBeCloseTo(0.01, 6);
    expect(p.recommended.sharesFor1Pct).toBe(50);
    expect(sharesForRisk(100, 98, 10_000)).toBe(50);
    expect(sharesForRisk(100, 100, 10_000)).toBe(0);
  });

  it("rejects too little history and a zero entry", () => {
    expect(planStop({ bars: flatBars(10, 100), entry: 100, entryDate: "2026-01-10" })).toHaveProperty("error");
    expect(planStop({ bars: flatBars(40, 100), entry: 0, entryDate: "2026-02-01" })).toHaveProperty("error");
  });
});

describe("planStop — where a past entry stands in the playbook", () => {
  beforeEach(resetDays);
  const base = () => flatBars(41, 100, 0.04); // entry on the 41st bar at 100, stop 98

  it("day 3 closing above the entry makes the partial due at the day-4 open and moves the stop to breakeven", () => {
    const bars = base();
    const entryDate = bars[40].date;
    bars.push(bar(100, 103, 99, 102), bar(102, 104, 101, 103), bar(103, 105, 102, 104), bar(104, 105, 103, 104.5));
    const p = plan(bars, 100, { entryDate });
    const s = p.status!;
    expect(s.sessionsHeld).toBe(5);
    expect(s.day3CloseAboveEntry).toBe(true);
    expect(s.partialDue).toBe("due");
    expect(s.partialDate).toBe(bars[43].date);
    expect(s.breakevenStop).toBe(100);
    expect(s.stoppedOut).toBe(false);
    expect(s.maExitDue).toBe(false);
    expect(s.unrealisedR).toBeCloseTo(2.25, 6);
  });

  it("day 3 closing under the entry means no partial", () => {
    const bars = base();
    const entryDate = bars[40].date;
    bars.push(bar(100, 101, 99, 100.5), bar(100.5, 101, 99, 99.5), bar(99.5, 101, 99, 100.5));
    const s = plan(bars, 100, { entryDate }).status!;
    expect(s.partialDue).toBe("n/a");
    expect(s.breakevenStop).toBeNull();
  });

  it("a later session's low at the stop marks it stopped out; the entry bar's own low does not", () => {
    const bars = base();
    const entryDate = bars[40].date;
    bars.push(bar(100, 101, 99, 100.5));
    expect(plan(bars, 100, { entryDate }).status!.stoppedOut).toBe(false); // entry bar low == stop, ignored
    bars.push(bar(100, 101, 97, 98));
    const s = plan(bars, 100, { entryDate }).status!;
    expect(s.stoppedOut).toBe(true);
    expect(s.stoppedDate).toBe(bars[42].date);
  });

  it("a close under the 10-day average flags the exit for the next open", () => {
    const bars = base();
    const entryDate = bars[40].date;
    bars.push(bar(100, 101, 98.5, 98.6)); // above the 98 stop, under the ~99.9 average
    const s = plan(bars, 100, { entryDate }).status!;
    expect(s.stoppedOut).toBe(false);
    expect(s.maExitDue).toBe(true);
    expect(s.maExitDate).toBe(bars[41].date);
  });

  it("has no status when the entry day is the last session", () => {
    expect(plan(base(), 100).status).toBeNull();
  });
});

describe("defaultTakeStop and takeStopError — the Take button prices like the Auto book", () => {
  beforeEach(resetDays);

  it("a market take (close above the trigger) stops at the last session's low", () => {
    const bars = [...flatBars(40, 100, 0.02), bar(102, 106, 103, 105)];
    expect(defaultTakeStop(bars, 101, 99)).toBe(103); // above the box top, as the Auto book's arm would be
  });

  it("a buy-stop still waiting for the break keeps the box bottom", () => {
    const bars = flatBars(40, 100, 0.02);
    expect(defaultTakeStop(bars, 101, 99)).toBe(99);
    expect(defaultTakeStop(bars, 101, null)).toBeNull();
  });

  it("only a buy-stop needs its stop under the trigger; every take needs it under the fill price", () => {
    expect(takeStopError("market", 103, 101, 105)).toBeNull();
    expect(takeStopError("buy_stop", 101, 101, 101)).toMatch(/below the trigger/);
    expect(takeStopError("market", 105, 101, 105)).toMatch(/below the last close/);
  });

  it("uses the same PARTIAL_DAY as the engine", () => {
    expect(CONFIG.PAPER.KULLAMAGI.PARTIAL_DAY).toBe(4);
  });
});
