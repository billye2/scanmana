import { describe, expect, it } from "vitest";
import { indexLines, latch, nextLine, readIndexTrend, trendRead, trendState } from "../lib/trend-read";
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

  it("ends the range on a close past its high", () => {
    const flat = Array.from({ length: 60 }, (_, i) => 130 * (1 + 0.01 * Math.sin(i / 2)));
    const closes = [...ramp(80, 100, 130), ...flat, 134];
    const t = readIndexTrend("SPY", series(closes))!;
    expect(t.state).not.toBe("range");
    expect(t.range).toBeNull();
    expect(t.highTest?.result).toBe("through");
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
