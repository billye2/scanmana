import { describe, expect, it } from "vitest";
import { betterLine, chartLevels, slopeWord, indexLines, latch, nextLine, readIndexTrend, stepCloses, trendRead, trendState, worseLine } from "../lib/trend-read";
import type { Bar } from "../lib/types";

/** Bars from closes: open = prior close, a 1% range around the body unless given. Weekday-free dates from 2026-01-01. */
function series(closes: number[], over: Record<number, Partial<Bar>> = {}): Bar[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return { date: d, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c, v: 1_000_000, ...over[i] };
  });
}
const ramp = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

describe("trendState — where the close sits against the 20- and 50-day", () => {
  it("names each of the seven states", () => {
    expect(trendState(true, true, true, true, true)).toBe("uptrend");
    expect(trendState(true, true, true, false, true)).toBe("recovering");
    expect(trendState(true, true, true, true, false)).toBe("recovering");
    expect(trendState(false, false, true, true, true)).toBe("pullback");
    expect(trendState(true, true, false, false, false)).toBe("repair");
    expect(trendState(false, false, false, true, true)).toBe("slipping");
    expect(trendState(true, false, false, false, false)).toBe("bounce");
    expect(trendState(false, false, false, false, false)).toBe("downtrend");
  });
});

describe("readIndexTrend", () => {
  it("is null without enough bars", () => {
    expect(readIndexTrend("SPY", series(ramp(60, 100, 120)))).toBeNull();
  });

  it("reads a steady climb as an uptrend at its high with nothing to repair", () => {
    const t = readIndexTrend("SPY", series(ramp(120, 100, 300)))!;
    expect(t.state).toBe("uptrend");
    expect(t.avgs.every((a) => a.dist > 0 && a.rising)).toBe(true);
    expect(t.high.dist).toBeGreaterThan(-0.006);
    expect(t.high.full).toBe(false);
    expect(t.bounce).toBeNull();
    expect(t.lowTest).toBeNull();
    expect(t.highTest?.result).toBe("through");
    const lines = indexLines(t);
    expect(lines[0]).toContain("above all three averages");
    expect(lines[1]).toBe("The averages are stacked 10 over 20 over 50, all three rising.");
    expect(lines[2]).toContain("At its high of the stored history");
    expect(nextLine([t])).toBe("Every check passes on SPY. The first warning would be a close under the 20-day.");
  });

  it("reads a steady slide as a downtrend closing under the prior low", () => {
    const t = readIndexTrend("QQQ", series(ramp(120, 160, 100)))!;
    expect(t.state).toBe("downtrend");
    expect(t.lowTest?.result).toBe("through");
    expect(t.bounce).toBeNull(); // the prior low was yesterday: no bounce to describe
    const lines = indexLines(t);
    expect(lines[0]).toContain("below all three averages");
    expect(lines[1]).toBe("The averages are stacked 10 under 20 under 50, all three falling.");
    expect(nextLine([t])).toMatch(/^Next to see: a close back above the 10-day on QQQ\. Then: the 10-day turning up,/);
  });

  it("describes a bounce that got over the 10-day, stalled under the 20-day and came back to the low", () => {
    // 100 flat sessions, a slide to 80, a six-session bounce to 86 on thin volume, then back to the low on heavy volume.
    const closes = [...ramp(100, 100, 100), ...ramp(10, 98, 80), 81, 82.5, 84, 85, 86, 85.5, 83, 81, 80.5];
    const n = closes.length;
    const over: Record<number, Partial<Bar>> = {};
    for (let i = 110; i <= 114; i++) over[i] = { v: 600_000 };
    for (let i = 115; i < n; i++) over[i] = { v: 1_500_000 };
    over[n - 1] = { v: 1_500_000, l: 79 }; // under the slide's low of 79.6, close back above it
    const t = readIndexTrend("SPY", series(closes, over))!;
    expect(t.state).toBe("downtrend");
    expect(t.bounce).not.toBeNull();
    expect(t.bounce!.running).toBe(false);
    expect(t.bounce!.peakClose).toBe(86);
    expect(t.bounce!.stalledUnder).toBe(20);
    expect(t.bounce!.volUp!).toBeLessThan(t.bounce!.volDown!);
    expect(t.lowTest?.result).toBe("rejected");
    const lines = indexLines(t);
    expect(lines.find((l) => l.startsWith("The bounce"))).toMatch(/topped at 86\.00 on .*: it got back over the 10-day and stalled \d+\.\d% under the 20-day\. Volume ran 0\.6× average on the way up and 1\.\d× since, heavier on the way down\./);
    expect(lines.at(-1)).toMatch(/^Traded under the .* low \(79\.60\) and closed back above it\.$/);
  });

  it("calls a bounce still making its best close 'running'", () => {
    const closes = [...ramp(100, 100, 100), ...ramp(10, 98, 80), 81, 82.5, 84, 85, 86];
    const t = readIndexTrend("SPY", series(closes))!;
    expect(t.state).toBe("bounce");
    expect(t.bounce!.running).toBe(true);
    expect(indexLines(t).find((l) => l.startsWith("Up "))).toMatch(/^Up \d\.\d% from the .* low, at its best close since\.$/);
  });
});

describe("latch — a side with a dead zone (1.9.9)", () => {
  const side = (xs: number[], band: number) => latch(0, xs.length - 1, (i) => xs[i], band);
  it("takes the first value's sign and holds it while later values stay inside the zone", () => {
    expect(side([0.02, 0.003, -0.003, 0.001, -0.004], 0.005)).toBe(true);
    expect(side([-0.02, 0.003, -0.003, 0.004], 0.005)).toBe(false);
  });
  it("changes side only once a value is past the zone", () => {
    expect(side([0.02, -0.004, -0.006], 0.005)).toBe(false);
    expect(side([-0.02, 0.004, 0.006, -0.002], 0.005)).toBe(true);
  });
  it("with no zone it is the sign of the last value", () => {
    expect(side([0.02, -0.001], 0)).toBe(false);
    expect(side([-0.02, 0.001], 0)).toBe(true);
  });
  it("skips bars with no reading", () => {
    expect(latch(0, 2, (i) => [null, 0.01, null][i], 0.005)).toBe(true);
  });
});

describe("dead zone and range (1.9.9)", () => {
  it("keeps the uptrend and says 'at' when a close dips a few tenths under the 20-day", () => {
    const closes = ramp(120, 100, 130);
    // the 20-day sits about 2.4 under the last close: put the close 0.2% under it
    const base = readIndexTrend("SPY", series(closes))!;
    const dipped = [...closes.slice(0, -1), base.avgs[1].value * 0.998];
    const t = readIndexTrend("SPY", series(dipped))!;
    expect(t.avgs[1].dist).toBeLessThan(0);
    expect(t.avgs[1].at).toBe(true);
    expect(t.avgs[1].above).toBe(true);
    expect(t.state).toBe("uptrend");
    expect(indexLines(t)[0]).toMatch(/sitting on its 20-day: .* at the 20-day \(\d+\.\d\d, 0\.\d% under\)/);
  });

  it("calls flat, tangled averages a range and names its high and low", () => {
    // a climb, then sixty sessions oscillating 1% around 130
    const closes = [...ramp(80, 100, 130), ...Array.from({ length: 60 }, (_, i) => 130 * (1 + 0.01 * Math.sin(i / 2)))];
    const t = readIndexTrend("SPY", series(closes))!;
    expect(t.state).toBe("range");
    expect(t.range!.low).toBeLessThan(130);
    expect(t.range!.high).toBeGreaterThan(130);
    expect(t.avgs[2].flat).toBe(true);
    expect(indexLines(t).find((l) => l.includes("so this is a range"))).toMatch(/held between \d+\.\d\d \(.*\) and \d+\.\d\d \(.*\)\.$/);
    expect(nextLine([t])).toMatch(/^SPY is in a range until it closes above \d+\.\d\d or below \d+\.\d\d\.$/);
    const r = trendRead(new Map([["SPY", series(closes)]]))!;
    expect(r.headline).toBe("Range on SPY");
    expect(r.tone).toBe("mixed");
  });

  it("ends the range on a close past its high, and the headline follows on the second close (2.0.0)", () => {
    const flat = Array.from({ length: 60 }, (_, i) => 130 * (1 + 0.01 * Math.sin(i / 2)));
    const first = readIndexTrend("SPY", series([...ramp(80, 100, 130), ...flat, 134]))!;
    expect(first.tonight).not.toBe("range");
    expect(first.range).toBeNull();
    expect(first.highTest?.result).toBe("through");
    expect(first.state).toBe("range"); // one close is not enough
    expect(indexLines(first)[0]).toBe(`Tonight's close by itself reads “Uptrend”; the headline holds at “Range” until a second close agrees.`);
    const second = readIndexTrend("SPY", series([...ramp(80, 100, 130), ...flat, 134, 135]))!;
    expect(second.tonight).toBe(first.tonight);
    expect(second.state).toBe(first.tonight);
    expect(indexLines(second)[0]).toMatch(/^Closed 135\.00/);
  });
});

describe("the two-close hold (2.0.0)", () => {
  it("ignores a state that lasts one session", () => {
    // a steady climb, one close 3% under everything, then straight back
    const up = ramp(120, 100, 130);
    const dip = [...up, 118];
    const t = readIndexTrend("SPY", series(dip))!;
    expect(t.tonight).not.toBe("uptrend");
    expect(t.state).toBe("uptrend");
    const back = readIndexTrend("SPY", series([...dip, 131]))!;
    expect(back.tonight).toBe("uptrend");
    expect(back.state).toBe("uptrend");
    expect(indexLines(back).some((l) => l.startsWith("Tonight's close by itself"))).toBe(false);
  });
});

describe("the prices behind 'gets better' and 'gets worse' (2.0.1)", () => {
  // a slide, so every ladder step is open
  const down = series(ramp(120, 160, 100));
  const next = (c: number): Bar => ({ date: "2026-12-31", o: c, h: c, l: c, c, v: 1_000_000 });

  it("names the close that passes each step: a hair over it passes, a hair under does not", () => {
    const now = readIndexTrend("QQQ", down)!;
    const needs = stepCloses(down);
    expect(needs).toHaveLength(7);
    const checks: ((t: NonNullable<ReturnType<typeof readIndexTrend>>) => boolean)[] = [
      (t) => t.avgs[0].above,
      (t) => t.avgs[0].rising,
      (t) => t.avgs[1].above,
      (t) => t.fastOverSlow,
      (t) => t.avgs[1].rising,
      (t) => t.avgs[2].above,
      (t) => t.avgs[2].rising,
    ];
    checks.forEach((ok, i) => {
      expect(ok(now)).toBe(false);
      expect(ok(readIndexTrend("QQQ", [...down, next(needs[i] * 1.0005)])!)).toBe(true);
      expect(ok(readIndexTrend("QQQ", [...down, next(needs[i] * 0.9995)])!)).toBe(false);
    });
  });

  it("writes the next step with its price and how many are left", () => {
    const t = readIndexTrend("QQQ", down)!;
    expect(betterLine(t)).toMatch(/^QQQ: a close above \d+\.\d\d \(\+\d+\.\d%\) gives a close back above the 10-day, the first of 7 steps left\.$/);
    const up = readIndexTrend("SPY", series(ramp(120, 100, 300)))!;
    expect(betterLine(up)).toBe("SPY: nothing to repair, every check passes.");
  });

  it("says when the next step takes more than one close, and names a later one within reach if there is one", () => {
    // a 10% drop on the last bar: every step is far away
    const far = readIndexTrend("QQQ", series([...ramp(119, 160, 100), 90]))!;
    expect(betterLine(far)).toBe("QQQ: a close back above the 10-day is next and takes more than one close; no later step is within a normal session either (7 left).");
    // the same read with the 20-day step put within reach by hand: the slope step is skipped, not priced
    const near = { ...far, avgs: far.avgs.map((a, k) => (k === 0 ? { ...a, above: true } : a)), needs: far.needs.map((n, k) => (k === 2 ? far.close * 1.01 : n)) };
    expect(betterLine(near)).toBe(`QQQ: the 10-day turning up is next and takes more than one close. Within reach tomorrow: a close above ${(far.close * 1.01).toFixed(2)} (+1.0%) gives a close above the 20-day.`);
  });

  it("lists the nearest supports under the close, nearest first", () => {
    const up = readIndexTrend("SPY", series(ramp(120, 100, 300)))!;
    expect(up.floors.map((f) => f.what)).toEqual(["the 10-day", "the 20-day"]);
    expect(up.floors[0].price).toBeGreaterThan(up.floors[1].price);
    expect(worseLine(up)).toMatch(/^SPY: a close under \d+\.\d\d \(the 10-day, −\d+\.\d%\), then \d+\.\d\d \(the 20-day, −\d+\.\d%\)\.$/);
    const t = readIndexTrend("QQQ", down)!;
    expect(t.floors).toHaveLength(1);
    expect(worseLine(t)).toMatch(/^QQQ: a close under \d+\.\d\d \(the .* low, −\d+\.\d%\)\.$/);
  });

  it("in a range both lines are the range's ends", () => {
    const closes = [...ramp(80, 100, 130), ...Array.from({ length: 60 }, (_, i) => 130 * (1 + 0.01 * Math.sin(i / 2)))];
    const t = readIndexTrend("SPY", series(closes))!;
    expect(betterLine(t)).toMatch(/leaves the range upward\.$/);
    expect(worseLine(t)).toMatch(/leaves the range downward\.$/);
  });

  it("keeps the card to the lines that carry a decision and leaves every fact in the full list", () => {
    const r = trendRead(new Map([["QQQ", down]]))!;
    const ix = r.indices[0];
    expect(ix.key[0]).toMatch(/^Closed 100\.00 \(−\d\.\d%\), below its 10-, 20- and 50-day, \d+\.\d% off the .* high\.$/);
    expect(ix.key.some((l) => l.startsWith("Closed below"))).toBe(true);
    expect(ix.key.some((l) => l.startsWith("The averages are stacked"))).toBe(false);
    expect(ix.lines.some((l) => l.startsWith("The averages are stacked"))).toBe(true);
    expect(ix.key.length).toBeLessThan(ix.lines.length);
    expect(r.ladder).toHaveLength(7);
    expect(r.ladder[0]).toEqual({ say: "a close back above the 10-day", pass: [], fail: ["QQQ"] });
    expect(r.better).toHaveLength(1);
    expect(r.worse).toHaveLength(1);
  });
});

describe("chart levels and chip slopes (2.0.2)", () => {
  it("draws the close that gets better and the low, not the averages the chart already has", () => {
    const t = readIndexTrend("QQQ", series(ramp(120, 160, 100)))!;
    const levels = chartLevels(t);
    expect(levels.map((l) => l.kind)).toEqual(["better", "worse", "test"]);
    expect(levels[0]).toEqual({ price: t.needs[0], label: "over 10d", kind: "better" });
    expect(levels[1].label).toMatch(/ low$/);
    const up = readIndexTrend("SPY", series(ramp(120, 100, 300)))!;
    expect(chartLevels(up)).toEqual([]); // nothing to repair, and its supports are the drawn averages
  });

  it("draws a range's two ends and collapses a level named twice", () => {
    const closes = [...ramp(80, 100, 130), ...Array.from({ length: 60 }, (_, i) => 130 * (1 + 0.01 * Math.sin(i / 2)))];
    const t = readIndexTrend("SPY", series(closes))!;
    const levels = chartLevels(t);
    expect(levels.slice(0, 2).map((l) => l.label)).toEqual(["range high", "range low"]);
    const prices = levels.map((l) => l.price);
    expect(new Set(prices.map((p) => p.toFixed(1))).size).toBe(prices.length);
  });

  it("says rising, flat or falling with the card's dead zone", () => {
    expect(slopeWord(series(ramp(120, 100, 160)), 20)).toBe("rising");
    expect(slopeWord(series(ramp(120, 160, 100)), 20)).toBe("falling");
    expect(slopeWord(series(ramp(120, 100, 100)), 20)).toBe("flat");
    expect(slopeWord(series(ramp(10, 100, 100)), 20)).toBeNull();
  });
});

describe("the 200-day line (2.0.0)", () => {
  it("is absent while the history is shorter than 200 sessions", () => {
    const t = readIndexTrend("SPY", series(ramp(150, 100, 160)))!;
    expect(t.long).toBeNull();
    expect(indexLines(t).some((l) => l.startsWith("Longer term"))).toBe(false);
  });

  it("calls a bounce over the short averages under a falling 200-day a rally inside a longer decline", () => {
    // 230 sessions down from 200 to 100, then 40 up to 120: over the 20- and 50-day, far under the 200-day
    const t = readIndexTrend("SPY", series([...ramp(230, 200, 100), ...ramp(40, 101, 125)]))!;
    expect(t.state).toBe("uptrend");
    expect(t.long!.dist).toBeLessThan(0);
    expect(indexLines(t).find((l) => l.startsWith("Longer term"))).toMatch(/^Longer term: \d+\.\d% under the 200-day \(\d+\.\d\d\), which is falling, so this is a rally inside a longer decline\.$/);
  });

  it("calls a slide under the short averages over a rising 200-day a setback inside a longer advance", () => {
    const t = readIndexTrend("SPY", series([...ramp(230, 100, 200), ...ramp(15, 198, 180)]))!;
    expect(t.state).toBe("downtrend");
    expect(indexLines(t).find((l) => l.startsWith("Longer term"))).toMatch(/over the 200-day \(\d+\.\d\d\), which is rising, so this is a setback inside a longer advance\.$/);
  });
});

describe("trendRead — both leaders", () => {
  it("is null with no usable index", () => {
    expect(trendRead(new Map())).toBeNull();
  });

  it("says 'on both' when the states agree and names the weaker index by its distance to the 50-day", () => {
    const r = trendRead(new Map([["QQQ", series(ramp(120, 160, 90))], ["SPY", series(ramp(120, 160, 130))]]))!;
    expect(r.tone).toBe("down");
    expect(r.headline).toBe("Downtrend on both, QQQ the weaker of the two");
    expect(r.indices.map((i) => i.ticker)).toEqual(["QQQ", "SPY"]);
    expect(r.next).toContain("on QQQ and SPY");
  });

  it("names each state when they differ and takes the worse tone", () => {
    const r = trendRead(new Map([["QQQ", series(ramp(120, 100, 160))], ["SPY", series(ramp(120, 160, 100))]]))!;
    expect(r.tone).toBe("down");
    expect(r.headline).toBe("Uptrend on QQQ, downtrend on SPY, QQQ holding up better");
    expect(r.next).toMatch(/on SPY\./);
  });

  it("is the same text for the same bars", () => {
    const m = () => new Map([["QQQ", series(ramp(120, 100, 160))], ["SPY", series(ramp(120, 100, 140))]]);
    expect(trendRead(m())).toEqual(trendRead(m()));
    expect(trendRead(m())!.headline).toBe("Uptrend on both, QQQ leading");
  });
});
