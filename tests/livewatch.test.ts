import { describe, expect, it } from "vitest";
import { classifyWatch, inMarketHours } from "../lib/livewatch";
import type { Quote } from "../lib/intraday";

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
