import { describe, expect, it } from "vitest";
import { EXIT_GRID, exitCells, exitLabel, exitRead } from "../lib/exit-read";
import type { SweepPoint } from "../lib/research";

const pt = (index: number, avgR: number, n = 774, sdR = 0.9, isCurrent = false): SweepPoint => ({
  param: "EXIT_GRID", value: index, deckSize: n, hitRate: 0.4, avgR, sdR, n, isCurrent,
});
const CURRENT = 5; // (4, 10, breakeven on)

describe("EXIT_GRID", () => {
  it("mirrors research/replay.py: partial day × MA × breakeven, 1-based", () => {
    expect(EXIT_GRID).toHaveLength(12);
    expect(EXIT_GRID[0]).toEqual({ index: 1, partialDay: 3, ma: 10, breakeven: true });
    expect(EXIT_GRID[4]).toEqual({ index: 5, partialDay: 4, ma: 10, breakeven: true });
    expect(EXIT_GRID[11]).toEqual({ index: 12, partialDay: 5, ma: 20, breakeven: false });
    expect(exitLabel(EXIT_GRID[4])).toBe("half off day 4 · 10-day exit · breakeven on");
  });
});

describe("exitCells", () => {
  it("fills missing cells with n 0 and keeps the current flag", () => {
    const cells = exitCells([pt(CURRENT, 0.05, 774, 0.9, true)]);
    expect(cells[4].isCurrent).toBe(true);
    expect(cells[4].interval).not.toBeNull();
    expect(cells[0].n).toBe(0);
    expect(cells[0].avgR).toBeNull();
  });
});

describe("exitRead", () => {
  it("is empty without a current cell", () => {
    expect(exitRead(exitCells([]), 4).state).toBe("empty");
  });
  it("is thin under the row floor", () => {
    const r = exitRead(exitCells([pt(CURRENT, 0.05, 12, 0.9, true), pt(1, 0.2, 12)]), 4);
    expect(r.state).toBe("thin");
    expect(r.sentence).toMatch(/needs 30 rows/);
  });
  it("says nothing to change when today's cell is the best", () => {
    const r = exitRead(exitCells([pt(CURRENT, 0.1, 774, 0.9, true), pt(1, 0.02)]), 4);
    expect(r.state).toBe("same");
    expect(r.gateMet).toBe(false);
  });
  it("calls overlapping ranges not a finding", () => {
    const r = exitRead(exitCells([pt(CURRENT, 0.05, 774, 0.9, true), pt(6, 0.08)]), 4);
    expect(r.state).toBe("overlap");
    expect(r.sentence).toMatch(/ranges overlap/);
  });
  it("meets the gate when apart and the paths agree on a later partial", () => {
    const r = exitRead(exitCells([pt(CURRENT, 0.05, 774, 0.5, true), pt(9, 0.2, 774, 0.5)]), 7); // (5, 10, on)
    expect(r.state).toBe("apart");
    expect(r.pathsAgree).toBe(true);
    expect(r.gateMet).toBe(true);
    expect(r.sentence).toMatch(/Gate met/);
  });
  it("holds the gate when the paths disagree, and ignores them when only the average moves", () => {
    const no = exitRead(exitCells([pt(CURRENT, 0.05, 774, 0.5, true), pt(9, 0.2, 774, 0.5)]), 3);
    expect(no.pathsAgree).toBe(false);
    expect(no.gateMet).toBe(false);
    const ma = exitRead(exitCells([pt(CURRENT, 0.05, 774, 0.5, true), pt(7, 0.2, 774, 0.5)]), 3); // (4, 20, on)
    expect(ma.pathsAgree).toBeNull();
    expect(ma.gateMet).toBe(true);
    const unknown = exitRead(exitCells([pt(CURRENT, 0.05, 774, 0.5, true), pt(9, 0.2, 774, 0.5)]), null);
    expect(unknown.gateMet).toBe(false);
  });
});
