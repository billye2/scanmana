// Paper-trading engine: pure functions over daily bars. No DB, no clock.
// The nightly job (lib/paper-db.ts) loads the book, calls processSession once
// per unprocessed session, then armDecisions for tonight's deck, and persists.
//
// Two tracks share one rule set except where noted:
//   auto   — every armed deck signal, flat NOTIONAL, no cash cap, exit by the
//            mechanical lowest-low trail. Nobody touches it: it measures the scanner.
//   manual — Billy's picks in a $10k account; cash binds; stop raised by hand or
//            by a chosen trail; partial sells. It measures Billy plus the scanner.
import { CONFIG } from "./config";
import { breakingOut } from "./analysis";
import type { Bar, Candidate } from "./types";

const P = CONFIG.PAPER;

export type Track = "auto" | "manual";
export type OrderStatus = "armed" | "armed_late" | "filled" | "cancelled";
export type TrailMode = "none" | "percent" | "lowestlow";
export type ExitReason = "stop" | "manual_sell";

export interface EngineOrder {
  id: number | null;
  track: Track;
  ticker: string;
  trigger: number;
  stop: number;
  status: OrderStatus;
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
  status: "open" | "closed";
  closedDate: string | null;
  exits: EngineExit[];
}

export type EngineEvent =
  | { type: "fill"; track: Track; ticker: string; price: number; shares: number; late: boolean }
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
}

export interface SessionResult {
  orders: EngineOrder[];
  positions: EnginePosition[];
  cash: Record<Track, number>;
  events: EngineEvent[];
}

/** Whole shares for a flat notional; 0 means one share costs more than the notional. */
export function sizeShares(price: number): number {
  return Math.floor(P.NOTIONAL / price);
}

function lowestLow(bars: Bar[], n: number): number {
  return Math.min(...bars.slice(-n).map((b) => b.l));
}

/** Where a trail would put the stop after this session, or null when the position has no trail. */
function trailLevel(p: EnginePosition, bars: Bar[]): number | null {
  if (p.track === "auto") return lowestLow(bars, P.TRAIL_LOOKBACK);
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
 * Advance the book through one session's bars. Per ticker, in order: pending
 * manual sells at the open; stop-outs (low <= stop, filled at min(open, stop));
 * order fills (armed: first high >= trigger at max(open, trigger); armed_late:
 * at the open) with sizing and cash; entry-day worst case (a bar that touches
 * both trigger and stop is a same-day stop-out); then peak/MFE/MAE, trails
 * (ratchet up only) and the split flag. Mutates copies, never the inputs.
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

    if (p.pendingSellShares && p.pendingSellShares > 0) {
      const shares = Math.min(p.pendingSellShares, p.shares);
      const exit: EngineExit = { date, price: bar.o, shares, reason: "manual_sell" };
      closeOut(p, exit);
      cash[p.track] += exit.price * shares;
      p.pendingSellShares = null;
      events.push({ type: "exit", track: p.track, ticker: p.ticker, position: p, exit });
      if (p.shares === 0) continue; // sold out entirely at the open
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
  }

  // 2. Live orders.
  for (const o of orders) {
    if (o.status !== "armed" && o.status !== "armed_late") continue;
    const bars = input.bars.get(o.ticker);
    const bar = bars?.[bars.length - 1];
    if (!bar || bar.date !== date) continue;

    // A manual order whose setup failed (closed under its own stop) is cancelled;
    // auto orders are re-decided from tonight's deck by armDecisions instead.
    if (o.track === "manual" && bar.c < o.stop && bar.h < o.trigger) {
      o.status = "cancelled";
      o.cancelledReason = "closed below the stop before triggering";
      events.push({ type: "cancel", track: o.track, ticker: o.ticker, reason: o.cancelledReason });
      continue;
    }
    if (openFor(o.track, o.ticker)) continue; // one open position per ticker per track

    let fill: number | null = null;
    if (o.status === "armed_late") fill = bar.o;
    else if (bar.h >= o.trigger) fill = Math.max(bar.o, o.trigger);
    if (fill === null) continue;

    const shares = sizeShares(fill);
    if (shares === 0) {
      o.status = "cancelled";
      o.cancelledReason = `one share (${fill.toFixed(2)}) costs more than the $${P.NOTIONAL} notional`;
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
    const late = o.status === "armed_late";
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
      trailMode: "none",
      trailParam: null,
      pendingSellShares: null,
      peakClose: bar.c,
      mfe: bar.h,
      mae: bar.l,
      late,
      splitFlagged: false,
      status: "open",
      closedDate: null,
      exits: [],
    };
    positions.push(p);
    events.push({ type: "fill", track: o.track, ticker: o.ticker, price: fill, shares, late: p.late });

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

export interface ArmDecision {
  ticker: string;
  trigger: number;
  stop: number;
}

/** Why a deck candidate is not an auto order tonight, or null when it is. */
export function armBlocker(c: Candidate): string | null {
  if (!c.box) return "no box";
  if (c.verdict !== "wait") return "verdict pass";
  const last = c.bars[c.bars.length - 1];
  if (last && last.c < c.box.bottom) return "closed below the box bottom";
  if (last && last.c > c.box.top && !breakingOut(c)) return "broke out earlier";
  return null;
}

/**
 * Tonight's auto orders: arm (or refresh) a buy-stop at the box top with the stop
 * at the box bottom for every boxed "wait" candidate that has not already left
 * the box, skipping tickers with an open auto position. Every live auto order
 * whose ticker is not in that set is cancelled with the reason.
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
    else arm.push({ ticker: c.ticker, trigger: c.box!.top, stop: c.box!.bottom });
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
