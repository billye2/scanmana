// Paper-trading engine: pure functions over daily bars. No DB, no clock.
// The nightly job (lib/paper-db.ts) loads the book, calls processSession once
// per unprocessed session, then armDecisions for tonight's deck, and persists.
//
// Two tracks share one rule set except where noted:
//   auto   — Kullamägi's playbook on every boxed Wait card that closes above its
//            box: buy the next open, stop at the breakout day's low, half off on
//            day 4 if up, breakeven, out at the next open after a close under the
//            10-day average. Flat NOTIONAL, no cash cap. Nobody touches it: it
//            measures the playbook on the scanner's picks.
//   manual — Billy's picks in a $10k account; cash binds; stop raised by hand or
//            by a chosen trail; partial sells. It measures Billy plus the scanner.
import { CONFIG } from "./config";
import { breakingOut } from "./analysis";
import { lowestLow, sma } from "./indicators";
import type { Bar, Candidate } from "./types";

const P = CONFIG.PAPER;
const K = P.KULLAMAGI;

export type Track = "auto" | "manual";
export type OrderStatus = "armed" | "filled" | "cancelled";
/** buy_stop waits for the trigger; market buys at the next open (price already above the trigger — a broker rejects a buy-stop below the market). */
export type OrderKind = "buy_stop" | "market";
/** kullamagi = the auto book's rule set (day-4 partial, breakeven, 10-day exit); the others are the manual trails. */
export type TrailMode = "none" | "percent" | "lowestlow" | "kullamagi";
/** partial = the day-4 half sale; ma_exit = sold at the open after a close under the 10-day average. */
export type ExitReason = "stop" | "manual_sell" | "partial" | "ma_exit";

export interface EngineOrder {
  id: number | null;
  track: Track;
  ticker: string;
  trigger: number;
  stop: number;
  kind: OrderKind;
  status: OrderStatus;
  /** Manual take placed after the auto order had already filled — recorded on the position. */
  late: boolean;
  armedDate: string;
  cancelledReason: string | null;
}

export interface EngineExit {
  date: string;
  price: number;
  shares: number;
  reason: ExitReason;
}

export interface EnginePosition {
  id: number | null;
  track: Track;
  ticker: string;
  orderId: number | null;
  entryDate: string;
  entryPrice: number;
  shares: number; // still held
  initialStop: number;
  currentStop: number;
  trailMode: TrailMode;
  trailParam: number | null; // percent (0.08) or session count (10)
  pendingSellShares: number | null;
  peakClose: number; // highest close since entry — the percent trail's anchor
  mfe: number; // highest high since entry
  mae: number; // lowest low since entry
  late: boolean; // manual take placed after the auto order had already filled
  splitFlagged: boolean;
  sessionsHeld: number; // sessions processed since entry, the entry day counting 1 — drives the day-4 partial
  status: "open" | "closed";
  closedDate: string | null;
  exits: EngineExit[];
}

export type EngineEvent =
  | { type: "fill"; track: Track; ticker: string; price: number; shares: number; late: boolean; sizeMult: number }
  | { type: "exit"; track: Track; ticker: string; position: EnginePosition; exit: EngineExit }
  | { type: "skip"; track: Track; ticker: string; reason: string }
  | { type: "cancel"; track: Track; ticker: string; reason: string }
  | { type: "split_flag"; track: Track; ticker: string };

export interface SessionInput {
  date: string;
  /** Each ticker's trailing bars ending at `date` (at least TRAIL_LOOKBACK + 1 for the trail). A ticker whose last bar is not `date` is skipped. */
  bars: Map<string, Bar[]>;
  orders: EngineOrder[];
  positions: EnginePosition[];
  cash: Record<Track, number>;
  /** Notional multiplier for fills this session, from the tape (lib/tape.ts). Defaults to 1. */
  sizeMult?: number;
}

export interface SessionResult {
  orders: EngineOrder[];
  positions: EnginePosition[];
  cash: Record<Track, number>;
  events: EngineEvent[];
}

/** Whole shares for the notional × the tape multiplier; 0 means one share costs more than that. */
export function sizeShares(price: number, sizeMult = 1): number {
  return Math.floor((P.NOTIONAL * sizeMult) / price);
}

/** Where a trail would put the stop after this session, or null when the position has no trail (none, or the Kullamägi rule set). */
function trailLevel(p: EnginePosition, bars: Bar[]): number | null {
  if (p.trailMode === "percent" && p.trailParam) return p.peakClose * (1 - p.trailParam);
  if (p.trailMode === "lowestlow") return lowestLow(bars, Math.max(1, Math.round(p.trailParam ?? P.TRAIL_LOOKBACK)));
  return null;
}

function closeOut(p: EnginePosition, exit: EngineExit): void {
  p.exits.push(exit);
  p.shares -= exit.shares;
  if (p.shares <= 0) {
    p.shares = 0;
    p.status = "closed";
    p.closedDate = exit.date;
  }
}

/**
 * Advance the book through one session's bars. Per open position, in order:
 * queued sells at the open (a manual sell, or the Kullamägi 10-day exit); the
 * Kullamägi day-4 half sale at the open with the stop moved to breakeven;
 * stop-outs (low <= stop, filled at min(open, stop)); peak/MFE/MAE; trails
 * (ratchet up only); the 10-day flag that queues tomorrow's exit; the split
 * flag. Then orders: buy_stop fills on the first high >= trigger at
 * max(open, trigger), market at the open (cancelled if the open is already
 * under the stop), with sizing and cash; entry-day worst case (a bar that
 * touches both trigger and stop is a same-day stop-out). Mutates copies, never
 * the inputs.
 */
export function processSession(input: SessionInput): SessionResult {
  const events: EngineEvent[] = [];
  const cash = { ...input.cash };
  const orders = input.orders.map((o) => ({ ...o }));
  const positions = input.positions.map((p) => ({ ...p, exits: [...p.exits] }));
  const { date } = input;

  const openFor = (track: Track, ticker: string) =>
    positions.find((p) => p.track === track && p.ticker === ticker && p.status === "open");

  // 1. Open positions.
  for (const p of positions) {
    if (p.status !== "open") continue;
    const bars = input.bars.get(p.ticker);
    const bar = bars?.[bars.length - 1];
    if (!bar || bar.date !== date) continue; // no data this session: leave it alone
    const prev = bars![bars!.length - 2];
    const kullamagi = p.trailMode === "kullamagi";
    const day = ++p.sessionsHeld; // the entry day was day 1

    if (p.pendingSellShares && p.pendingSellShares > 0) {
      const shares = Math.min(p.pendingSellShares, p.shares);
      const exit: EngineExit = { date, price: bar.o, shares, reason: kullamagi ? "ma_exit" : "manual_sell" };
      closeOut(p, exit);
      cash[p.track] += exit.price * shares;
      p.pendingSellShares = null;
      events.push({ type: "exit", track: p.track, ticker: p.ticker, position: p, exit });
      if (p.shares === 0) continue; // sold out entirely at the open
    }

    // Kullamägi: on day 4, if yesterday closed above entry, sell half at the open and
    // move the stop to breakeven. A one-share position has nothing to halve but still
    // earns the breakeven stop.
    if (kullamagi && day === K.PARTIAL_DAY && prev && prev.c > p.entryPrice) {
      const shares = Math.floor(p.shares * K.PARTIAL_FRACTION);
      if (shares > 0) {
        const exit: EngineExit = { date, price: bar.o, shares, reason: "partial" };
        closeOut(p, exit);
        cash[p.track] += exit.price * shares;
        events.push({ type: "exit", track: p.track, ticker: p.ticker, position: p, exit });
      }
      p.currentStop = Math.max(p.currentStop, p.entryPrice);
    }

    // Flag before the stop check: a split shows up as a gap that would "stop out" a
    // position that in truth just changed share count. Advisory only.
    if (prev && Math.abs(bar.o / prev.c - 1) > P.SPLIT_GAP_PCT && !p.splitFlagged) {
      p.splitFlagged = true;
      events.push({ type: "split_flag", track: p.track, ticker: p.ticker });
    }

    if (bar.l <= p.currentStop) {
      const exit: EngineExit = { date, price: Math.min(bar.o, p.currentStop), shares: p.shares, reason: "stop" };
      closeOut(p, exit);
      cash[p.track] += exit.price * exit.shares;
      p.mae = Math.min(p.mae, bar.l);
      events.push({ type: "exit", track: p.track, ticker: p.ticker, position: p, exit });
      continue;
    }
    p.peakClose = Math.max(p.peakClose, bar.c);
    p.mfe = Math.max(p.mfe, bar.h);
    p.mae = Math.min(p.mae, bar.l);
    const level = trailLevel(p, bars!);
    if (level !== null && level > p.currentStop) p.currentStop = level;
    // Kullamägi: a close under the 10-day average sells what is left at tomorrow's open.
    if (kullamagi) {
      const avg = sma(bars!, K.MA);
      if (avg !== null && bar.c < avg) p.pendingSellShares = p.shares;
    }
  }

  // 2. Live orders.
  for (const o of orders) {
    if (o.status !== "armed") continue;
    const bars = input.bars.get(o.ticker);
    const bar = bars?.[bars.length - 1];
    if (!bar || bar.date !== date) continue;

    // A manual order whose setup failed (closed under its own stop) is cancelled;
    // auto orders are re-decided from tonight's deck by armDecisions instead.
    if (o.track === "manual" && o.kind === "buy_stop" && bar.c < o.stop && bar.h < o.trigger) {
      o.status = "cancelled";
      o.cancelledReason = "closed below the stop before triggering";
      events.push({ type: "cancel", track: o.track, ticker: o.ticker, reason: o.cancelledReason });
      continue;
    }
    if (openFor(o.track, o.ticker)) continue; // one open position per ticker per track

    // A market buy whose open is already at or under the stop would be a zero-length
    // round trip at the open; a trader would stand aside, so the order is cancelled.
    if (o.kind === "market" && bar.o <= o.stop) {
      o.status = "cancelled";
      o.cancelledReason = `opened at ${bar.o.toFixed(2)}, under the ${o.stop.toFixed(2)} stop`;
      events.push({ type: "cancel", track: o.track, ticker: o.ticker, reason: o.cancelledReason });
      continue;
    }

    let fill: number | null = null;
    if (o.kind === "market") fill = bar.o;
    else if (bar.h >= o.trigger) fill = Math.max(bar.o, o.trigger);
    if (fill === null) continue;

    const sizeMult = input.sizeMult ?? 1;
    const shares = sizeShares(fill, sizeMult);
    if (shares === 0) {
      o.status = "cancelled";
      o.cancelledReason = `one share (${fill.toFixed(2)}) costs more than the $${Math.round(P.NOTIONAL * sizeMult)} notional${sizeMult < 1 ? " at this tape size" : ""}`;
      events.push({ type: "skip", track: o.track, ticker: o.ticker, reason: o.cancelledReason });
      continue;
    }
    const cost = shares * fill;
    if (o.track === "manual" && cost > cash.manual) {
      o.status = "cancelled";
      o.cancelledReason = `insufficient cash at fill: needs $${cost.toFixed(2)}, has $${cash.manual.toFixed(2)}`;
      events.push({ type: "skip", track: o.track, ticker: o.ticker, reason: o.cancelledReason });
      continue;
    }
    cash[o.track] -= cost;
    const late = o.late;
    o.status = "filled";
    const p: EnginePosition = {
      id: null,
      track: o.track,
      ticker: o.ticker,
      orderId: o.id,
      entryDate: date,
      entryPrice: fill,
      shares,
      initialStop: o.stop,
      currentStop: o.stop,
      trailMode: o.track === "auto" ? "kullamagi" : "none",
      trailParam: null,
      pendingSellShares: null,
      peakClose: bar.c,
      mfe: bar.h,
      mae: bar.l,
      late,
      splitFlagged: false,
      sessionsHeld: 1,
      status: "open",
      closedDate: null,
      exits: [],
    };
    positions.push(p);
    events.push({ type: "fill", track: o.track, ticker: o.ticker, price: fill, shares, late: p.late, sizeMult });

    if (bar.l <= o.stop) {
      // The order of the two touches inside the day is unknowable; assume the worse one.
      const exit: EngineExit = { date, price: Math.min(bar.o, o.stop), shares, reason: "stop" };
      closeOut(p, exit);
      cash[o.track] += exit.price * shares;
      events.push({ type: "exit", track: o.track, ticker: o.ticker, position: p, exit });
      continue;
    }
    const level = trailLevel(p, bars!);
    if (level !== null && level > p.currentStop) p.currentStop = level;
  }

  return { orders, positions, cash, events };
}

/** What `morningBrief` needs of an open position: the engine's row plus the last stored close. */
export type BriefPosition = Pick<EnginePosition, "track" | "ticker" | "entryPrice" | "currentStop" | "pendingSellShares" | "sessionsHeld" | "trailMode" | "shares"> & {
  lastClose: number | null;
};

export interface MorningBrief {
  /** Market orders that fill at the open. */
  buys: { ticker: string; track: Track }[];
  /** Manual buy-stops still waiting on their trigger. */
  buyStops: { ticker: string; trigger: number }[];
  /** Auto positions sold half at the open (day 4, up on the entry). */
  halfOff: string[];
  /** Positions sold at the open: the 10-day exit or a requested manual sell. */
  exits: { ticker: string; reason: "ma_exit" | "manual_sell"; partial: boolean }[];
  /** Positions still held after the open. */
  holds: number;
  /** The held position whose stop sits closest under the last close (stop / close − 1). */
  nearestStop: { ticker: string; pct: number } | null;
  /** Tape size label for the buys ("half", "quarter"), null at full size. */
  size: string | null;
  /** True when nothing fills, sells or is held. */
  empty: boolean;
}

/**
 * Tomorrow morning in one read, from the book as the nightly run left it: the
 * rows already carry the open's intent (a pending sell is the 10-day exit or
 * a requested sale; a day-4 half-off follows from the sessions held and
 * yesterday's close against the entry — the same tests `processSession`
 * applies at the open). No bars. Pure.
 */
export type BriefOrder = Pick<EngineOrder, "ticker" | "track" | "kind" | "trigger"> & { status?: OrderStatus };

export function morningBrief(orders: BriefOrder[], positions: BriefPosition[], sizeLabel: string | null): MorningBrief {
  const armed = orders.filter((o) => o.status === undefined || o.status === "armed");
  const buys = armed.filter((o) => o.kind === "market").map((o) => ({ ticker: o.ticker, track: o.track }));
  const buyStops = armed.filter((o) => o.kind === "buy_stop").map((o) => ({ ticker: o.ticker, trigger: o.trigger }));
  const halfOff: string[] = [];
  const exits: MorningBrief["exits"] = [];
  let holds = 0;
  let nearestStop: MorningBrief["nearestStop"] = null;
  for (const p of positions) {
    if (p.shares <= 0) continue;
    const pending = p.pendingSellShares ?? 0;
    if (pending > 0) {
      const partial = pending < p.shares;
      exits.push({ ticker: p.ticker, reason: p.trailMode === "kullamagi" ? "ma_exit" : "manual_sell", partial });
      if (!partial) continue;
    } else if (
      p.trailMode === "kullamagi" &&
      p.sessionsHeld + 1 === K.PARTIAL_DAY &&
      p.lastClose !== null &&
      p.lastClose > p.entryPrice &&
      Math.floor(p.shares * K.PARTIAL_FRACTION) > 0
    ) {
      halfOff.push(p.ticker);
    }
    holds++;
    if (p.lastClose !== null && p.lastClose > 0) {
      const pct = p.currentStop / p.lastClose - 1;
      if (nearestStop === null || pct > nearestStop.pct) nearestStop = { ticker: p.ticker, pct };
    }
  }
  const size = sizeLabel && sizeLabel !== "full" ? sizeLabel : null;
  return { buys, buyStops, halfOff, exits, holds, nearestStop, size, empty: buys.length + buyStops.length + exits.length + holds === 0 };
}

const list = (t: string[]) => t.join(", ");
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

/** The brief as one sentence for the home strip and the paper page. */
export function briefText(b: MorningBrief): string {
  if (b.empty) return "Nothing to do: no orders armed, no positions open.";
  const parts: string[] = [];
  if (b.buys.length) parts.push(`Buys ${list(b.buys.map((o) => o.ticker))}${b.size ? ` at ${b.size} size` : ""}`);
  if (b.buyStops.length) parts.push(`Buy-stops ${list(b.buyStops.map((o) => `${o.ticker} above ${o.trigger.toFixed(2)}`))}`);
  if (b.halfOff.length) parts.push(`Half off ${list(b.halfOff)} (day ${K.PARTIAL_DAY}, up)`);
  const ma = b.exits.filter((e) => e.reason === "ma_exit").map((e) => e.ticker);
  const sells = b.exits.filter((e) => e.reason === "manual_sell").map((e) => (e.partial ? `some of ${e.ticker}` : e.ticker));
  if (ma.length) parts.push(`Exit ${list(ma)} (closed under the ${K.MA}-day)`);
  if (sells.length) parts.push(`Sell ${list(sells)} (requested)`);
  parts.push(
    b.holds === 0
      ? "Holds nothing"
      : `Holds ${b.holds}${b.nearestStop ? `, nearest stop ${b.nearestStop.ticker} ${signed(b.nearestStop.pct)}` : ""}`,
  );
  return parts.join(" · ");
}

/** The brief for the nightly push: the actions only, nothing when there are none. */
export function briefPush(b: MorningBrief): string | null {
  const parts: string[] = [];
  if (b.buys.length) parts.push(`buy ${list(b.buys.map((o) => o.ticker))}${b.size ? ` (${b.size})` : ""}`);
  if (b.halfOff.length) parts.push(`half off ${list(b.halfOff)}`);
  const sold = b.exits.map((e) => e.ticker);
  if (sold.length) parts.push(`${b.exits.every((e) => e.reason === "ma_exit") ? "exit" : "sell"} ${list(sold)}`);
  return parts.length ? `At the open: ${parts.join(" · ")}` : null;
}

export interface ArmDecision {
  ticker: string;
  trigger: number;
  stop: number;
  kind: OrderKind;
}

/** Why a deck candidate is not an auto order tonight, or null when it is. */
export function armBlocker(c: Pick<Candidate, "box" | "verdict" | "bars">): string | null {
  if (!c.box) return "no box";
  if (c.verdict !== "wait") return "verdict pass";
  const last = c.bars[c.bars.length - 1];
  if (last && last.c < c.box.bottom) return "closed below the box bottom";
  if (last && last.c > c.box.top && !breakingOut(c)) return "broke out earlier";
  if (!breakingOut(c)) return "waiting for a close above the box";
  return null;
}

/**
 * Tonight's auto orders: a market buy at tomorrow's open, with the stop at
 * today's low, for every boxed "wait" candidate that closed above its box top
 * today (Kullamägi's entry: the break confirmed by the close, risk to the low of
 * the breakout day). Nothing is armed while price sits inside the box; names
 * that broke out earlier and tickers with an open auto position are skipped.
 * Every live auto order whose ticker is not in that set is cancelled with the
 * reason — including, on the night this rule shipped, the old buy-stops.
 */
export function armDecisions(
  candidates: Candidate[],
  liveOrders: EngineOrder[],
  openTickers: Set<string>,
): { arm: ArmDecision[]; cancel: { ticker: string; reason: string }[] } {
  const arm: ArmDecision[] = [];
  const blocked = new Map<string, string>();
  for (const c of candidates) {
    if (openTickers.has(c.ticker)) {
      blocked.set(c.ticker, "position open");
      continue;
    }
    const why = armBlocker(c);
    if (why) blocked.set(c.ticker, why);
    else {
      // Stop at the breakout day's low — the same rule `defaultTakeStop` (lib/stop-plan.ts)
      // applies to a manual "Take at open", so both books price one entry the same way.
      const last = c.bars[c.bars.length - 1];
      arm.push({ ticker: c.ticker, trigger: c.box!.top, stop: last.l, kind: "market" });
    }
  }
  const armed = new Set(arm.map((a) => a.ticker));
  const cancel: { ticker: string; reason: string }[] = [];
  for (const o of liveOrders) {
    if (o.track !== "auto" || armed.has(o.ticker)) continue;
    cancel.push({ ticker: o.ticker, reason: blocked.get(o.ticker) ?? "dropped from the scan" });
  }
  return { arm, cancel };
}

export interface ClosedTrade {
  closedDate: string;
  pnl: number;
  r: number;
}

export interface TrackStats {
  trades: number;
  winRate: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancyR: number | null;
  profitFactor: number | null; // null when there are no losses yet
  equityCurve: { date: string; equity: number }[]; // realized, cumulative
}

/** Realized result of a position: dollars and R (risk = entry − initial stop per share, on the full size). */
export function realized(p: EnginePosition): { pnl: number; r: number } {
  const pnl = p.exits.reduce((s, e) => s + (e.price - p.entryPrice) * e.shares, 0);
  const size = p.shares + p.exits.reduce((s, e) => s + e.shares, 0);
  const risk = (p.entryPrice - p.initialStop) * size;
  return { pnl, r: risk > 0 ? pnl / risk : 0 };
}

/**
 * How far the stop has travelled since entry: `moved` once it sits above the
 * initial stop (trail or manual raise), `lockedR` the R the current stop secures
 * — negative while it is under entry, positive once above — or null when the
 * initial risk is zero.
 */
export function stopProgress(p: EnginePosition): { moved: boolean; lockedR: number | null } {
  const risk = p.entryPrice - p.initialStop;
  return {
    moved: p.currentStop > p.initialStop,
    lockedR: risk > 0 ? (p.currentStop - p.entryPrice) / risk : null,
  };
}

export function computeStats(closed: ClosedTrade[]): TrackStats {
  const n = closed.length;
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  let equity = 0;
  const equityCurve = [...closed]
    .sort((a, b) => a.closedDate.localeCompare(b.closedDate))
    .map((t) => ({ date: t.closedDate, equity: (equity += t.pnl) }));
  return {
    trades: n,
    winRate: n ? wins.length / n : null,
    avgWinR: mean(wins.map((t) => t.r)),
    avgLossR: mean(losses.map((t) => t.r)),
    expectancyR: mean(closed.map((t) => t.r)),
    profitFactor: n && grossLoss > 0 ? grossWin / grossLoss : null,
    equityCurve,
  };
}
