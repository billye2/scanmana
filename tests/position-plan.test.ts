import { describe, expect, it } from "vitest";
import { positionPlan, type PlanPosition } from "../lib/position-plan";

const pos = (over: Partial<PlanPosition> = {}): PlanPosition => ({
  entryPrice: 100,
  shares: 40,
  currentStop: 97,
  trailMode: "kullamagi",
  trailParam: null,
  pendingSellShares: null,
  sessionsHeld: 1,
  peakClose: 104,
  lastClose: 104,
  maLine: 101,
  halved: false,
  ...over,
});

describe("positionPlan", () => {
  it("holds, with the stop, the close that must hold and the day count", () => {
    const p = positionPlan(pos());
    expect(p.action).toBe("hold");
    expect(p.headline).toBe("Tomorrow: hold.");
    expect(p.rules).toEqual([
      "Stop $97.00, 6.7% under the last close. A trade at or under it sells everything.",
      "A close under $101.00 tomorrow sells the rest at the next open. That is 2.9% under the last close.",
      "Tomorrow is day 2. Half comes off at the day-4 open, 2 sessions after that, if the close before it is above $100.00.",
    ]);
  });

  it("sells half at the day-4 open after a close above the entry and quotes the stop at the entry", () => {
    const p = positionPlan(pos({ sessionsHeld: 3 }));
    expect(p.action).toBe("part");
    expect(p.headline).toBe("Tomorrow: sell 20 of 40 at the open. It is day 4 and it closed above the entry. The stop then moves up to the entry, $100.00.");
    expect(p.rules[0]).toBe("Stop $100.00, 3.8% under the last close. A trade at or under it sells everything, and at that price the trade no longer loses.");
    expect(p.rules).toHaveLength(2);
  });

  it("says no half comes off when day 4 arrives under the entry", () => {
    const p = positionPlan(pos({ sessionsHeld: 3, lastClose: 99, maLine: 100.5 }));
    expect(p.action).toBe("hold");
    expect(p.rules[1]).toBe("A close under $100.50 tomorrow sells the rest at the next open. That is above the last close, so it has to close up 1.5% or more to stay.");
    expect(p.rules[2]).toBe("Tomorrow is day 4 and it closed at or under the entry, so no half comes off.");
  });

  it("drops the day count once the half is sold", () => {
    const p = positionPlan(pos({ sessionsHeld: 6, halved: true, shares: 20, currentStop: 100 }));
    expect(p.rules).toHaveLength(2);
    expect(p.rules[0]).toContain("no longer loses");
  });

  it("sells everything on a pending exit, with the reason for each book", () => {
    expect(positionPlan(pos({ pendingSellShares: 40 }))).toEqual({ action: "sell", headline: "Tomorrow: sell all 40 at the open. It closed under the 10-day.", rules: [] });
    expect(positionPlan(pos({ pendingSellShares: 40, trailMode: "none" })).headline).toBe("Tomorrow: sell all 40 at the open. You asked for the sale.");
  });

  it("handles a requested part sale and the manual trails", () => {
    const part = positionPlan(pos({ pendingSellShares: 10, trailMode: "percent", trailParam: 0.08 }));
    expect(part.action).toBe("part");
    expect(part.headline).toBe("Tomorrow: sell 10 of 40 at the open, as you asked. Hold the rest.");
    expect(part.rules[1]).toBe("The stop trails 8% under the highest close, now $104.00. A close above that raises it.");
    expect(positionPlan(pos({ trailMode: "lowestlow", trailParam: 10 })).rules[1]).toBe("The stop follows the 10-session low and only moves up.");
    expect(positionPlan(pos({ trailMode: "none" })).rules[1]).toBe("No trail is set. The stop stays where it is until you raise it.");
  });

  it("warns when the last close is already at the stop and copes with no close or no average", () => {
    expect(positionPlan(pos({ lastClose: 96.5 })).rules[0]).toBe("Stop $97.00. The last close is at or under it, so expect the sale tomorrow.");
    const bare = positionPlan(pos({ lastClose: null, maLine: null }));
    expect(bare.rules[0]).toBe("Stop $97.00. A trade at or under it sells everything.");
    expect(bare.rules).toHaveLength(2);
  });
});
