import { describe, expect, it } from "vitest";
import {
  armDecisions,
  computeStats,
  processSession,
  realized,
  sizeShares,
  type EngineOrder,
  type EnginePosition,
  type SessionInput,
} from "../lib/paper-engine";
import type { Bar, Candidate } from "../lib/types";
import { bar, flatBars, resetDays } from "./fixtures";

const order = (over: Partial<EngineOrder> = {}): EngineOrder => ({
  id: 1,
  track: "auto",
  ticker: "X",
  trigger: 50,
  stop: 45,
  status: "armed",
  armedDate: "2026-01-01",
  cancelledReason: null,
  ...over,
});

const position = (over: Partial<EnginePosition> = {}): EnginePosition => ({
  id: 10,
  track: "manual",
  ticker: "X",
  orderId: null,
  entryDate: "2026-01-02",
  entryPrice: 50,
  shares: 10,
  initialStop: 45,
  currentStop: 45,
  trailMode: "none",
  trailParam: null,
  pendingSellShares: null,
  peakClose: 50,
  mfe: 50,
  mae: 50,
  late: false,
  splitFlagged: false,
  status: "open",
  closedDate: null,
  exits: [],
  ...over,
});

/** 11 quiet bars at $48 (lows $47.04) then the given session bar, all for ticker X. */
function session(last: Bar, ticker = "X"): { date: string; bars: Map<string, Bar[]> } {
  resetDays();
  const history = flatBars(11, 48, 0.04);
  const bars = [...history, { ...last, date: "2026-02-01" }];
  return { date: "2026-02-01", bars: new Map([[ticker, bars]]) };
}

function run(over: Partial<SessionInput>, last: Bar) {
  const s = session(last);
  return processSession({ ...s, orders: [], positions: [], cash: { auto: 0, manual: 10_000 }, ...over });
}

describe("sizeShares", () => {
  it("floors whole shares for the $500 notional and reports 0 above it", () => {
    expect(sizeShares(50)).toBe(10);
    expect(sizeShares(49.9)).toBe(10);
    expect(sizeShares(501)).toBe(0);
  });
});

describe("processSession — fills", () => {
  it("fills a buy-stop at the trigger when the high reaches it", () => {
    const r = run({ orders: [order()] }, bar(48, 51, 47.5, 50.5));
    expect(r.orders[0].status).toBe("filled");
    expect(r.positions).toHaveLength(1);
    // The auto trail applies from the entry day: the 10-session low (47.04) already sits above the box bottom.
    expect(r.positions[0]).toMatchObject({ entryPrice: 50, shares: 10, initialStop: 45, currentStop: 47.04, late: false, status: "open" });
    expect(r.events[0]).toMatchObject({ type: "fill", price: 50, shares: 10 });
  });

  it("gap above the trigger fills at the open, not the trigger", () => {
    const r = run({ orders: [order()] }, bar(52, 53, 51.5, 52.5));
    expect(r.positions[0].entryPrice).toBe(52);
    expect(r.positions[0].shares).toBe(9); // floor(500 / 52)
  });

  it("does not fill when the high stays under the trigger", () => {
    const r = run({ orders: [order()] }, bar(48, 49.9, 47.5, 49));
    expect(r.orders[0].status).toBe("armed");
    expect(r.positions).toHaveLength(0);
  });

  it("entry day that also touches the stop is a same-day stop-out at the worse price", () => {
    const r = run({ orders: [order()] }, bar(48, 50.5, 44, 44.5));
    const p = r.positions[0];
    expect(p.status).toBe("closed");
    expect(p.exits).toEqual([{ date: "2026-02-01", price: 45, shares: 10, reason: "stop" }]);
    expect(realized(p)).toEqual({ pnl: -50, r: -1 });
  });

  it("a late manual take fills at the open regardless of the trigger", () => {
    const r = run({ orders: [order({ track: "manual", status: "armed_late" })] }, bar(48, 49, 47.5, 48.5));
    expect(r.positions[0]).toMatchObject({ entryPrice: 48, late: true, track: "manual" });
    expect(r.cash.manual).toBe(10_000 - 48 * 10);
  });

  it("skips and cancels when one share costs more than the notional", () => {
    const r = run({ orders: [order({ trigger: 600, stop: 550 })] }, bar(590, 610, 585, 605));
    expect(r.orders[0].status).toBe("cancelled");
    expect(r.positions).toHaveLength(0);
    expect(r.events[0]).toMatchObject({ type: "skip" });
    expect(r.events[0].type === "skip" && r.events[0].reason).toMatch(/one share/);
  });

  it("manual fill is refused when cash is short; the auto track has no cap", () => {
    const orders = [order({ id: 1, track: "auto" }), order({ id: 2, track: "manual" })];
    const r = run({ orders, cash: { auto: 0, manual: 100 } }, bar(48, 51, 47.5, 50.5));
    expect(r.orders[0].status).toBe("filled");
    expect(r.orders[1].status).toBe("cancelled");
    expect(r.orders[1].cancelledReason).toMatch(/insufficient cash/);
    expect(r.cash).toEqual({ auto: -500, manual: 100 });
  });

  it("ignores a fill for a ticker that already has an open position on that track", () => {
    const r = run({ orders: [order({ track: "manual" })], positions: [position()] }, bar(48, 51, 47.5, 50.5));
    expect(r.orders[0].status).toBe("armed");
    expect(r.positions).toHaveLength(1);
  });

  it("cancels a manual order whose setup closed under its stop before triggering", () => {
    const r = run({ orders: [order({ track: "manual" })] }, bar(46, 46.5, 43, 44));
    expect(r.orders[0]).toMatchObject({ status: "cancelled", cancelledReason: expect.stringMatching(/below the stop/) });
  });

  it("leaves a ticker alone when it has no bar for the session", () => {
    const s = session(bar(48, 51, 47.5, 50.5));
    s.bars.get("X")!.pop(); // last bar is no longer the session date
    const r = processSession({ ...s, orders: [order()], positions: [position()], cash: { auto: 0, manual: 0 } });
    expect(r.orders[0].status).toBe("armed");
    expect(r.positions[0].status).toBe("open");
  });
});

describe("processSession — open positions", () => {
  it("stops out at the stop, or at the open when it gapped below", () => {
    const touch = run({ positions: [position()] }, bar(47, 48, 44.5, 46));
    expect(touch.positions[0].exits[0]).toMatchObject({ price: 45, shares: 10, reason: "stop" });
    expect(touch.cash.manual).toBe(10_000 + 450);

    const gap = run({ positions: [position()] }, bar(40, 42, 39, 41));
    expect(gap.positions[0].exits[0].price).toBe(40);
  });

  it("auto trail ratchets the stop up to the 10-session low and never lowers it", () => {
    resetDays();
    const history = flatBars(11, 60, 0.04); // lows 58.8
    const up = { ...bar(60, 62, 59, 61), date: "2026-02-01" };
    const r1 = processSession({
      date: "2026-02-01",
      bars: new Map([["X", [...history, up]]]),
      orders: [],
      positions: [position({ track: "auto", currentStop: 45 })],
      cash: { auto: 0, manual: 0 },
    });
    expect(r1.positions[0].currentStop).toBeCloseTo(58.8, 6);

    // Next session holds above the stop; the window still contains the $58.8 lows, so the stop stays put.
    const dip = { ...bar(60, 61, 59.5, 60.5), date: "2026-02-02" };
    const r2 = processSession({
      date: "2026-02-02",
      bars: new Map([["X", [...history, up, dip].slice(-11)]]),
      orders: [],
      positions: r1.positions,
      cash: { auto: 0, manual: 0 },
    });
    expect(r2.positions[0].status).toBe("open");
    expect(r2.positions[0].currentStop).toBeCloseTo(58.8, 6);
  });

  it("manual position without a trail keeps its stop; the percent trail hangs off the peak close", () => {
    const plain = run({ positions: [position()] }, bar(60, 62, 59, 61));
    expect(plain.positions[0].currentStop).toBe(45);
    expect(plain.positions[0]).toMatchObject({ peakClose: 61, mfe: 62, mae: 50 });

    const pct = run({ positions: [position({ trailMode: "percent", trailParam: 0.1 })] }, bar(60, 62, 59, 61));
    expect(pct.positions[0].currentStop).toBeCloseTo(54.9, 6);
  });

  it("a pending sell fills at the open; the rest stays open with a blended exit later", () => {
    const half = run({ positions: [position({ pendingSellShares: 5 })] }, bar(56, 57, 55, 56.5));
    const p = half.positions[0];
    expect(p).toMatchObject({ shares: 5, pendingSellShares: null, status: "open" });
    expect(p.exits).toEqual([{ date: "2026-02-01", price: 56, shares: 5, reason: "manual_sell" }]);
    expect(half.cash.manual).toBe(10_000 + 280);

    const rest = run({ positions: half.positions }, bar(46, 47, 44, 44.5));
    const done = rest.positions[0];
    expect(done.status).toBe("closed");
    expect(done.exits).toHaveLength(2);
    // (56-50)*5 + (45-50)*5 = 30 - 25 = 5 dollars on a $50 risk (10 shares × $5)
    expect(realized(done)).toEqual({ pnl: 5, r: 0.1 });
  });

  it("flags a 40%+ overnight gap as a possible split without changing anything else", () => {
    const r = run({ positions: [position()] }, bar(28, 29, 27, 28.5)); // prior close 48 → open 28, -42%
    expect(r.positions[0].splitFlagged).toBe(true);
    expect(r.events.some((e) => e.type === "split_flag")).toBe(true);
    // It still opened under the stop, so the position is stopped out at the open — flagged for a by-hand check.
    expect(r.positions[0].status).toBe("closed");
    expect(r.positions[0].exits[0].price).toBe(28);
    // A 37% gap is under the threshold: no flag.
    expect(run({ positions: [position()] }, bar(30, 31, 29, 30.5)).positions[0].splitFlagged).toBe(false);
  });
});

const cand = (over: Partial<Candidate>): Candidate => {
  resetDays();
  return {
    ticker: "X", name: "X Corp", price: 48, dollarVol: 5e7, ret1m: 0.3, ret3m: 0.6, ret6m: 1.2, adrPct: 4,
    distFromHigh: 0.05, tightness: 1, box: { top: 50, bottom: 45, startDate: "2026-01-01", confirmed: true },
    pivot: null, ep: null, bars: flatBars(12, 48, 0.04), verdict: "wait", ...over,
  };
};

describe("armDecisions", () => {
  it("arms boxed wait candidates, skips pass, pivot-only, open and broke-earlier names, keeps today's break", () => {
    const bars = flatBars(12, 48, 0.04);
    const brokeToday = [...bars.slice(0, 11), { ...bars[11], c: 51 }];
    const brokeEarlier = [...bars.slice(0, 10), { ...bars[10], c: 51 }, { ...bars[11], c: 52 }];
    const cs = [
      cand({ ticker: "OK" }),
      cand({ ticker: "PASS", verdict: "pass" }),
      cand({ ticker: "PIV", box: null, pivot: 50 }),
      cand({ ticker: "OPEN" }),
      cand({ ticker: "TODAY", bars: brokeToday }),
      cand({ ticker: "EARLIER", bars: brokeEarlier }),
      cand({ ticker: "UNDER", bars: [...bars.slice(0, 11), { ...bars[11], c: 44 }] }),
    ];
    const live = [
      order({ ticker: "OK" }),
      order({ ticker: "PASS" }),
      order({ ticker: "GONE" }),
      order({ ticker: "MANUAL", track: "manual" }),
    ];
    const d = armDecisions(cs, live, new Set(["OPEN"]));
    expect(d.arm.map((a) => a.ticker)).toEqual(["OK", "TODAY"]);
    expect(d.arm[0]).toEqual({ ticker: "OK", trigger: 50, stop: 45 });
    expect(d.cancel).toEqual([
      { ticker: "PASS", reason: "verdict pass" },
      { ticker: "GONE", reason: "dropped from the scan" },
    ]);
  });
});

describe("computeStats", () => {
  it("summarises closed trades and builds a realized equity curve in date order", () => {
    const s = computeStats([
      { closedDate: "2026-02-03", pnl: -50, r: -1 },
      { closedDate: "2026-02-01", pnl: 100, r: 2 },
      { closedDate: "2026-02-02", pnl: 25, r: 0.5 },
    ]);
    expect(s.trades).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3, 6);
    expect(s.avgWinR).toBe(1.25);
    expect(s.avgLossR).toBe(-1);
    expect(s.expectancyR).toBe(0.5);
    expect(s.profitFactor).toBe(2.5);
    expect(s.equityCurve).toEqual([
      { date: "2026-02-01", equity: 100 },
      { date: "2026-02-02", equity: 125 },
      { date: "2026-02-03", equity: 75 },
    ]);
    expect(computeStats([]).winRate).toBeNull();
  });
});
