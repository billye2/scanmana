import { describe, expect, it } from "vitest";
import { gradeStops, inStopDrill, isStopKey, replayKullamagi, stopChoices, stopOutcomeText, stopVerdictText, STOP_GRID_DAYS } from "../lib/drill-stop";
import type { Bar } from "../lib/types";

// The same bars research/replay.py _replay_kullamagi was run on (2026-11-10): o = c − 0.5, h = c + 1, l = c − 1.5.
const win = (closes: number[]): Bar[] => closes.map((c, i) => ({ date: `2026-02-${String(i + 1).padStart(2, "0")}`, o: c - 0.5, h: c + 1, l: c - 1.5, c, v: 1e6 }));
const A = [101, 103, 104, 106, 109, 111, 110, 112, 115, 117, 116, 113, 109, 108, 107];
const B = [101, 102, 104, 103, 100.2, 99, 98];
const PRE = [95, 96, 97, 98, 99, 99.5, 100, 100, 100.5];

describe("replayKullamagi", () => {
  it("matches the Python routine: half off on day 4, the rest at the open after a close under the 10-day", () => {
    const r = replayKullamagi(win(A), 100.5, 97, PRE)!;
    expect(r.r).toBeCloseTo(1.714286, 5);
    expect(r.reason).toBe("ma");
    expect(r.exitDay).toBe(14);
  });

  it("matches the Python routine: half off, then out at breakeven", () => {
    const r = replayKullamagi(win(B), 100.5, 97, PRE)!;
    expect(r.r).toBeCloseTo(0.171429, 5);
    expect(r.reason).toBe("breakeven");
    expect(r.exitDay).toBe(5);
  });

  it("books a stop touched on the entry day at −1R and refuses a stop that is not under the entry", () => {
    expect(replayKullamagi(win(A), 100.5, 99.6, PRE)).toEqual({ r: -1, reason: "stop", exitDay: 1 });
    expect(replayKullamagi(win(A), 100.5, 100.5, PRE)).toBeNull();
  });

  it("marks a trade the bars run out on to the last close", () => {
    const r = replayKullamagi(win([101, 103, 105]), 100.5, 97, PRE)!;
    expect(r.reason).toBe("open");
    expect(r.exitDay).toBe(3);
    expect(r.r).toBeCloseTo((105 - 100.5) / 3.5, 6);
  });
});

// Scan night closes 99 under a 100 box (bottom 94). Two sessions later it closes 101; the entry is the next open.
const before = win([90, 91, 93, 95, 97, 98, 99, 98, 97, 98, 99]).map((b, i) => ({ ...b, date: `2026-01-${String(i + 1).padStart(2, "0")}` }));
const SCAN = before[before.length - 1].date;
const after = win([99.5, 101, ...A]);
const row = { date: SCAN, close: 99, boxed: true, boxTop: 100, boxBottom: 94, adrPct: 4 };

describe("stopChoices", () => {
  it("prices the two levels the chart shows tonight and leaves the two set at the entry open", () => {
    const c = stopChoices(row, before);
    expect(c.map((x) => x.key)).toEqual(["breakout_low", "adr", "low10", "box_bottom"]);
    expect(c[0].price).toBeNull();
    expect(c[1].under).toBeCloseTo(0.04);
    expect(c[2].price).toBeCloseTo(89.5); // the lowest low of the last ten sessions: 91 − 1.5
    expect(c[3].price).toBe(94);
    expect(c[3].under).toBeCloseTo(0.06);
  });

  it("asks only on a boxed card at or under its top", () => {
    expect(inStopDrill(row)).toBe(true);
    expect(inStopDrill({ ...row, close: 101 })).toBe(false);
    expect(inStopDrill({ ...row, boxed: false })).toBe(false);
    expect(isStopKey("low10")).toBe(true);
    expect(isStopKey("nope")).toBe(false);
  });
});

describe("gradeStops", () => {
  const drill = gradeStops(row, [...before, ...after]);

  it("enters the open after the first close above the box and runs every stop on that trade", () => {
    expect(drill.filled).toBe(true);
    expect(drill.breakoutDate).toBe(after[1].date);
    expect(drill.entry).toBe(100.5);
    expect(drill.days).toBe(A.length);
    expect(drill.days).toBeLessThanOrEqual(STOP_GRID_DAYS);
    const by = Object.fromEntries(drill.results.map((x) => [x.key, x]));
    expect(by.breakout_low.stop).toBe(99.5); // the breakout day's low
    expect(by.breakout_low.r).toBe(-1); // the entry day's low is 99.5 too
    expect(by.adr.stop).toBeCloseTo(100.5 * 0.96);
    expect(by.box_bottom.risk).toBeCloseTo(6.5 / 100.5);
    expect(by.box_bottom.reason).toBe("ma");
    expect(by.box_bottom.r!).toBeLessThan(by.adr.r!); // same exits, wider stop, fewer R
  });

  it("says so when there was no trade or the chosen level was not usable", () => {
    const none = gradeStops(row, [...before, ...win([99, 98, 97])]);
    expect(none.filled).toBe(false);
    expect(stopVerdictText(none, "adr")).toContain("never closed above the box");
    const noBox = gradeStops({ ...row, boxBottom: null }, [...before, ...after]);
    expect(stopOutcomeText(noBox.results[3])).toBe("no such level");
    expect(stopVerdictText(noBox, "box_bottom")).toContain("made no trade");
  });

  it("sets the reader's stop against the book's and the best of the four", () => {
    const text = stopVerdictText(drill, "adr");
    expect(text).toContain("Your stop: sold under the average day 14");
    expect(text).toContain("The book's stop made −1.0R.");
    expect(text).toContain("The best of the four.");
    expect(stopVerdictText(drill, "breakout_low")).toContain("Best of the four: one ADR under the entry");
  });
});
