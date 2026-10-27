import { CONFIG } from "./config";
import { findDarvasBox } from "./darvas";
import { adrPct, lowestLow, sma } from "./indicators";
import type { Bar } from "./types";

/**
 * Prices a stop for a position opened without a plan, by Kullamägi's rules.
 * Pure: bars in, numbers out. Used by /sim and by the manual Take's default
 * stop, so the simulator and the paper book can never price one entry two ways.
 *
 * Bars are ascending and may end in a provisional today bar. The entry day is
 * day 1. The entry date snaps to the last bar at or before it (`snappedFrom`
 * keeps the date asked for). Sessions are counted in bars, never calendar days.
 *
 * Ladder (usable = the level sits under the entry; wide = farther than one ADR):
 *  1 entry_low     the low of the day you bought — Kullamägi's stop.
 *  2 breakout_low  the low of the most recent session at or before the entry day
 *                  that closed above its Darvas box with the prior close at or
 *                  under the top; the box is the one that was broken (found on
 *                  the bars before that session). Looked for in the 10 sessions
 *                  to the entry day; absent when price never closed above a box.
 *  3 box_bottom    the Darvas box bottom as of the entry day, when a box exists.
 *  4 low10         the lowest low of the 10 sessions ending on the entry day
 *                  (the Auto book's trail before 1.3.7).
 *  5 sma10, sma20  the 10- and 20-day averages as of the last bar: the lines the
 *                  rest is trailed on. Reference rows, never recommended.
 *  6 adr_cap       entry × (1 − ADR); one average day's range. The limit, not a
 *                  level: a stop farther away than this is `wide`.
 *
 * Recommendation, first match:
 *  a entry_low when usable and not wide.
 *  b else the tightest usable, not-wide structural level: breakout_low, box_bottom.
 *  c else entry_low, flagged wide, with the share count that keeps the risk at
 *     1% of cash (`cutSizeTo`).
 *  d else (bought at the low of the day) adr_cap, with a warning.
 *
 * Status, when the entry day is not the last bar: sessions held (entry day = 1),
 * whether day 3 closed above the entry (then half is sold at the day-4 open and
 * the stop goes to breakeven), whether a later session's low reached the stop
 * (the breakeven stop from day 4 on, once half is sold), whether a later session
 * closed under its 10-day average (the rest is sold at the next open), and the
 * open R against the recommended stop. All from CONFIG.PAPER.KULLAMAGI, the same
 * numbers the Auto book runs.
 */

export type CandidateKey = "entry_low" | "breakout_low" | "box_bottom" | "low10" | "sma10" | "sma20" | "adr_cap";

export interface StopCandidate {
  key: CandidateKey;
  label: string;
  price: number;
  riskPerShare: number; // entry − price (negative when the level is above the entry)
  riskPct: number; // riskPerShare / entry
  note: string;
  usable: boolean; // price < entry
  wide: boolean; // riskPct > one ADR
  sharesFor1Pct: number; // shares that keep the $ risk at 1% of cash; 0 when not usable
  dollarRisk: number | null; // shares × riskPerShare when shares were given
  pctOfCash: number | null; // dollarRisk / cash
}

export interface PlanStatus {
  sessionsHeld: number; // entry day = 1
  day3CloseAboveEntry: boolean | null; // null before day 3 exists
  partialDue: "pending" | "due" | "n/a"; // due: sell half at the day-4 open and move the stop to breakeven
  partialDate: string | null; // the day-4 session
  breakevenStop: number | null; // = entry once the partial is due
  stoppedOut: boolean;
  stoppedDate: string | null;
  maExitDue: boolean; // a session after entry closed under its 10-day average
  maExitDate: string | null; // that session; the sale is at the next open
  current: number; // last close
  unrealisedR: number | null; // (current − entry) / (entry − stop)
}

export interface StopPlan {
  entryDate: string;
  snappedFrom: string | null;
  entry: number;
  adrPct: number | null;
  candidates: StopCandidate[]; // ladder order (see above)
  recommended: StopCandidate;
  reason: string;
  cutSizeTo: number | null; // shares that keep a wide stop at 1% of cash
  status: PlanStatus | null;
  warnings: string[];
}

export interface PlanInput {
  bars: Bar[];
  entry: number;
  entryDate: string; // ISO; snaps back to a session
  shares?: number;
  cash?: number; // defaults to the manual book's starting cash
}

const K = CONFIG.PAPER.KULLAMAGI;
const MIN_BARS = 25; // enough for the 20-day ADR and the averages; the deck's own minimum is far higher
const BREAKOUT_LOOKBACK = 10; // a breakout older than two weeks is not the one this entry is riding
const LABELS: Record<CandidateKey, string> = {
  entry_low: "Entry-day low",
  breakout_low: "Breakout-day low",
  box_bottom: "Box bottom",
  low10: "10-session low",
  sma10: "10-day average",
  sma20: "20-day average",
  adr_cap: "One-ADR cap",
};

/** Whole shares that keep entry − stop at `riskFrac` of cash; 0 when the stop is not below the entry. */
export function sharesForRisk(entry: number, stop: number, cash: number, riskFrac = 0.01): number {
  const risk = entry - stop;
  if (!(risk > 0)) return 0;
  return Math.floor((cash * riskFrac) / risk);
}

/**
 * The manual Take's default stop: a market buy at the next open (last close above
 * the trigger) stops at the last session's low, as the Auto book does on a
 * breakout day; a buy-stop still waiting for the break keeps the box bottom.
 */
export function defaultTakeStop(bars: Bar[], trigger: number, boxBottom: number | null): number | null {
  const last = bars[bars.length - 1];
  if (last && last.c > trigger && last.l < last.c) return last.l;
  return boxBottom;
}

/** Why a Take's stop is not acceptable, or null. A buy-stop's stop sits under the trigger; any stop sits under the price the fill will be near. */
export function takeStopError(kind: "buy_stop" | "market", stop: number, trigger: number, est: number): string | null {
  if (kind === "buy_stop" && !(stop < trigger)) return "the stop must sit below the trigger";
  if (!(stop < est)) return `the stop must sit below the last close (${est.toFixed(2)})`;
  return null;
}

/** The most recent session at or before `idx` that closed above the box it was in, with the box top it beat. */
function findBreakout(bars: Bar[], idx: number): { bar: Bar; top: number } | null {
  for (let k = idx; k >= Math.max(1, idx - BREAKOUT_LOOKBACK + 1); k--) {
    const box = findDarvasBox(bars.slice(0, k));
    if (!box) continue;
    if (bars[k].c > box.top && bars[k - 1].c <= box.top) return { bar: bars[k], top: box.top };
  }
  return null;
}

export function planStop(input: PlanInput): StopPlan | { error: string } {
  const { bars, entry } = input;
  const cash = input.cash ?? CONFIG.PAPER.MANUAL_START_CASH;
  const shares = input.shares && input.shares > 0 ? Math.floor(input.shares) : null;
  if (!(entry > 0)) return { error: "the entry price must be above zero" };
  if (bars.length < MIN_BARS) return { error: `need at least ${MIN_BARS} sessions of history (have ${bars.length})` };

  let idx = -1;
  for (let k = bars.length - 1; k >= 0; k--) {
    if (bars[k].date <= input.entryDate) {
      idx = k;
      break;
    }
  }
  if (idx < 0) return { error: `no session on or before ${input.entryDate} (history starts ${bars[0].date})` };
  const entryBar = bars[idx];
  const upTo = bars.slice(0, idx + 1);
  const adr = adrPct(upTo, CONFIG.ADR_WINDOW);
  const warnings: string[] = [];
  if (bars.length < CONFIG.MIN_BARS) warnings.push(`short history: ${bars.length} sessions, so the box and averages are less reliable`);
  if (entry > entryBar.h || entry < entryBar.l) {
    warnings.push(`${entry.toFixed(2)} is outside the ${entryBar.date} range ${entryBar.l.toFixed(2)}–${entryBar.h.toFixed(2)}; check the price and the date`);
  }

  const mk = (key: CandidateKey, price: number, note: string, label = LABELS[key]): StopCandidate => {
    const riskPerShare = entry - price;
    const riskPct = riskPerShare / entry;
    const usable = price > 0 && price < entry;
    const wide = adr !== null && riskPct > adr / 100;
    const sharesFor1Pct = usable ? sharesForRisk(entry, price, cash) : 0;
    const dollarRisk = usable && shares ? shares * riskPerShare : null;
    return { key, label, price, riskPerShare, riskPct, note, usable, wide, sharesFor1Pct, dollarRisk, pctOfCash: dollarRisk !== null ? dollarRisk / cash : null };
  };

  const candidates: StopCandidate[] = [];
  candidates.push(mk("entry_low", entryBar.l, `the low of ${entryBar.date}, the session you bought`));
  const breakout = findBreakout(bars, idx);
  if (breakout) {
    candidates.push(mk("breakout_low", breakout.bar.l, `the low of ${breakout.bar.date}, the session that closed above the ${breakout.top.toFixed(2)} box top`));
  }
  const box = findDarvasBox(upTo);
  if (box) candidates.push(mk("box_bottom", box.bottom, `the floor of the ${box.bottom.toFixed(2)}–${box.top.toFixed(2)} box as of ${entryBar.date}`));
  candidates.push(mk("low10", lowestLow(upTo, CONFIG.PAPER.TRAIL_LOOKBACK), `the lowest low of the ${CONFIG.PAPER.TRAIL_LOOKBACK} sessions to ${entryBar.date}`));
  const s10 = sma(bars, K.MA);
  const s20 = sma(bars, CONFIG.SMA_SLOW);
  const lastDate = bars[bars.length - 1].date;
  if (s10 !== null) candidates.push(mk("sma10", s10, `as of ${lastDate}; a close under it sells the rest at the next open`));
  if (s20 !== null) candidates.push(mk("sma20", s20, `as of ${lastDate}; the slower trail`));
  if (adr !== null) candidates.push(mk("adr_cap", entry * (1 - adr / 100), `one average day's range (${adr.toFixed(1)}%) under the entry; anything farther is a wide stop`));

  const by = (key: CandidateKey) => candidates.find((c) => c.key === key);
  const entryLow = by("entry_low")!;
  let recommended: StopCandidate | undefined;
  let reason: string;
  let cutSizeTo: number | null = null;
  if (entryLow.usable && !entryLow.wide) {
    recommended = entryLow;
    reason = "Kullamägi's stop: the low of the day you bought. It is within one average day's range, so a normal session cannot take it out.";
  } else {
    const structural = (["breakout_low", "box_bottom"] as CandidateKey[])
      .map(by)
      .filter((c): c is StopCandidate => !!c && c.usable && !c.wide)
      .sort((a, b) => b.price - a.price);
    if (structural.length > 0) {
      recommended = structural[0];
      reason = `The entry-day low is ${entryLow.usable ? "more than one average day away" : "not below your entry"}; the ${recommended.label.toLowerCase()} is the tightest level price has respected within that range.`;
    } else if (entryLow.usable) {
      recommended = entryLow;
      cutSizeTo = sharesForRisk(entry, entryLow.price, cash);
      reason = `The low of the day you bought is ${(entryLow.riskPct * 100).toFixed(1)}% away, wider than one average day${adr !== null ? ` (${adr.toFixed(1)}%)` : ""}. Kullamägi keeps the level and cuts the size: ${cutSizeTo} shares keep the risk at 1% of $${cash.toLocaleString()}.`;
    } else {
      const cap = by("adr_cap");
      if (!cap || !cap.usable) return { error: "no level under the entry to put a stop at" };
      recommended = cap;
      reason = "You bought at the low of the day, so there is no structural level under the entry. One average day's range is the widest stop the playbook allows.";
      warnings.push("no structural level under your entry; the cap is a limit, not a level price has respected");
    }
  }

  let status: PlanStatus | null = null;
  if (idx < bars.length - 1) {
    const sessionsHeld = bars.length - idx;
    const day3 = bars[idx + 2];
    const day3CloseAboveEntry = day3 ? day3.c > entry : null;
    const partialDue: PlanStatus["partialDue"] = sessionsHeld >= K.PARTIAL_DAY ? (day3CloseAboveEntry ? "due" : "n/a") : "pending";
    const breakevenStop = partialDue === "due" ? entry : null;
    let stoppedDate: string | null = null;
    let maExitDate: string | null = null;
    for (let k = idx + 1; k < bars.length; k++) {
      const eff = breakevenStop !== null && k >= idx + K.PARTIAL_DAY - 1 ? Math.max(recommended.price, breakevenStop) : recommended.price;
      if (stoppedDate === null && bars[k].l <= eff) stoppedDate = bars[k].date;
      const m = sma(bars.slice(0, k + 1), K.MA);
      if (maExitDate === null && m !== null && bars[k].c < m) maExitDate = bars[k].date;
    }
    const current = bars[bars.length - 1].c;
    status = {
      sessionsHeld,
      day3CloseAboveEntry,
      partialDue,
      partialDate: partialDue === "due" ? (bars[idx + K.PARTIAL_DAY - 1]?.date ?? null) : null,
      breakevenStop,
      stoppedOut: stoppedDate !== null,
      stoppedDate,
      maExitDue: maExitDate !== null,
      maExitDate,
      current,
      unrealisedR: recommended.usable ? (current - entry) / recommended.riskPerShare : null,
    };
  }

  return {
    entryDate: entryBar.date,
    snappedFrom: entryBar.date === input.entryDate ? null : input.entryDate,
    entry,
    adrPct: adr,
    candidates,
    recommended,
    reason,
    cutSizeTo,
    status,
    warnings,
  };
}
