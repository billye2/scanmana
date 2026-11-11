import { CONFIG } from "./config";
import type { EnginePosition } from "./paper-engine";

/**
 * Tomorrow's instruction for one open position (/paper, 1.9.3, step 4 of the
 * stop-manager list): what happens at the open, where the stop is, and the exact
 * prices that would change either. From the book's row as the nightly run left
 * it, the last stored close, and one number from the bars. Pure.
 *
 * `maLine` is the mean of the last MA − 1 closes. Tomorrow's close c is under
 * tomorrow's MA-day average exactly when c < that mean (c < (sum + c) / MA), so
 * it is the price the close has to hold, not an estimate from today's average.
 * The same tests as lib/paper-engine.ts processSession: the half at the day-4
 * open when the prior close is above the entry, then the stop to the entry; a
 * low at or under the stop sells everything; a close under the average sells
 * the rest at the next open.
 */

const K = CONFIG.PAPER.KULLAMAGI;

export type PlanPosition = Pick<
  EnginePosition,
  "entryPrice" | "shares" | "currentStop" | "trailMode" | "trailParam" | "pendingSellShares" | "sessionsHeld" | "peakClose"
> & {
  lastClose: number | null;
  maLine: number | null;
  /** True once the day-4 half has been sold. */
  halved: boolean;
};

export interface PositionPlan {
  /** What the open does: sell everything, sell part, or nothing. */
  action: "sell" | "part" | "hold";
  headline: string;
  /** The standing rules after the open, most pressing first. Empty when everything is sold. */
  rules: string[];
}

const px = (x: number) => `$${x.toFixed(2)}`;
const pct = (x: number) => `${(Math.abs(x) * 100).toFixed(1)}%`;

export function positionPlan(p: PlanPosition): PositionPlan {
  const kullamagi = p.trailMode === "kullamagi";
  const pending = p.pendingSellShares ?? 0;
  if (pending >= p.shares && pending > 0) {
    return {
      action: "sell",
      headline: `Tomorrow: sell all ${p.shares} at the open. ${kullamagi ? `It closed under the ${K.MA}-day.` : "You asked for the sale."}`,
      rules: [],
    };
  }
  const half = Math.floor(p.shares * K.PARTIAL_FRACTION);
  const halfDue =
    pending === 0 && kullamagi && !p.halved && p.sessionsHeld + 1 === K.PARTIAL_DAY && p.lastClose !== null && p.lastClose > p.entryPrice && half > 0;
  const stop = halfDue ? Math.max(p.currentStop, p.entryPrice) : p.currentStop;
  const headline =
    pending > 0
      ? `Tomorrow: sell ${pending} of ${p.shares} at the open, as you asked. Hold the rest.`
      : halfDue
        ? `Tomorrow: sell ${half} of ${p.shares} at the open. It is day ${K.PARTIAL_DAY} and it closed above the entry. The stop then moves up to the entry, ${px(p.entryPrice)}.`
        : "Tomorrow: hold.";

  const rules: string[] = [];
  const safe = stop >= p.entryPrice;
  if (p.lastClose !== null && p.lastClose <= stop) {
    rules.push(`Stop ${px(stop)}. The last close is at or under it, so expect the sale tomorrow.`);
  } else {
    const room = p.lastClose !== null && p.lastClose > 0 ? `, ${pct(1 - stop / p.lastClose)} under the last close` : "";
    rules.push(`Stop ${px(stop)}${room}. A trade at or under it sells everything${safe ? ", and at that price the trade no longer loses" : ""}.`);
  }
  if (kullamagi) {
    if (p.maLine !== null) {
      const where =
        p.lastClose === null
          ? ""
          : p.maLine < p.lastClose
            ? ` That is ${pct(1 - p.maLine / p.lastClose)} under the last close.`
            : ` That is above the last close, so it has to close up ${pct(p.maLine / p.lastClose - 1)} or more to stay.`;
      rules.push(`A close under ${px(p.maLine)} tomorrow sells the rest at the next open.${where}`);
    }
    if (!p.halved && !halfDue) {
      const next = p.sessionsHeld + 1;
      if (next < K.PARTIAL_DAY) {
        const n = K.PARTIAL_DAY - next;
        rules.push(
          `Tomorrow is day ${next}. Half comes off at the day-${K.PARTIAL_DAY} open, ${n} session${n === 1 ? "" : "s"} after that, if the close before it is above ${px(p.entryPrice)}.`,
        );
      } else if (next === K.PARTIAL_DAY) {
        rules.push(`Tomorrow is day ${K.PARTIAL_DAY} and it closed at or under the entry, so no half comes off.`);
      }
    }
  } else if (p.trailMode === "percent") {
    rules.push(`The stop trails ${((p.trailParam ?? 0) * 100).toFixed(0)}% under the highest close, now ${px(p.peakClose)}. A close above that raises it.`);
  } else if (p.trailMode === "lowestlow") {
    rules.push(`The stop follows the ${p.trailParam ?? CONFIG.PAPER.TRAIL_LOOKBACK}-session low and only moves up.`);
  } else {
    rules.push("No trail is set. The stop stays where it is until you raise it.");
  }
  return { action: pending > 0 || halfDue ? "part" : "hold", headline, rules };
}
