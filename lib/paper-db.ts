// Paper-trading persistence. The engine (lib/paper-engine.ts) is pure; this
// module loads a user's book, runs it, and writes the result back. Everything
// goes through getSql() so the COIL_DATABASE_URL rule in lib/db.ts holds.
import { CONFIG } from "./config";
import { etToday } from "./dates";
import { getSql } from "./db";
import {
  armDecisions,
  computeStats,
  processSession,
  realized,
  sizeShares,
  type EngineEvent,
  type EngineExit,
  type EngineOrder,
  type EnginePosition,
  type Track,
  type TrackStats,
  type TrailMode,
} from "./paper-engine";
import type { Bar, ScanPayload } from "./types";

const P = CONFIG.PAPER;
const TRACKS: Track[] = ["auto", "manual"];

/* ---------- row mapping ---------- */

interface OrderRow {
  id: number;
  track: Track;
  ticker: string;
  trigger: number;
  stop: number;
  status: EngineOrder["status"];
  armed_date: string;
  cancelled_reason: string | null;
}
const toOrder = (r: OrderRow): EngineOrder => ({
  id: r.id,
  track: r.track,
  ticker: r.ticker,
  trigger: r.trigger,
  stop: r.stop,
  status: r.status,
  armedDate: r.armed_date,
  cancelledReason: r.cancelled_reason,
});

interface PositionRow {
  id: number;
  track: Track;
  ticker: string;
  order_id: number | null;
  entry_date: string;
  entry_price: number;
  shares: number;
  initial_stop: number;
  current_stop: number;
  trail_mode: TrailMode;
  trail_param: number | null;
  pending_sell_shares: number | null;
  peak_close: number;
  mfe: number;
  mae: number;
  late: boolean;
  split_flagged: boolean;
  status: "open" | "closed";
  closed_date: string | null;
}
const toPosition = (r: PositionRow, exits: EngineExit[]): EnginePosition => ({
  id: r.id,
  track: r.track,
  ticker: r.ticker,
  orderId: r.order_id,
  entryDate: r.entry_date,
  entryPrice: r.entry_price,
  shares: r.shares,
  initialStop: r.initial_stop,
  currentStop: r.current_stop,
  trailMode: r.trail_mode,
  trailParam: r.trail_param,
  pendingSellShares: r.pending_sell_shares,
  peakClose: r.peak_close,
  mfe: r.mfe,
  mae: r.mae,
  late: r.late,
  splitFlagged: r.split_flagged,
  status: r.status,
  closedDate: r.closed_date,
  exits,
});

const ORDER_COLS = `id, track, ticker, trigger_price AS trigger, stop_price AS stop, status, armed_date::text AS armed_date, cancelled_reason`;
const POSITION_COLS = `id, track, ticker, order_id, entry_date::text AS entry_date, entry_price, shares, initial_stop, current_stop,
  trail_mode, trail_param, pending_sell_shares, peak_close, mfe, mae, late, split_flagged, status, closed_date::text AS closed_date`;

async function liveOrders(userId: string): Promise<EngineOrder[]> {
  const sql = getSql();
  const rows = (await sql.query(
    `SELECT ${ORDER_COLS} FROM paper_orders WHERE user_id = $1 AND status IN ('armed', 'armed_late') ORDER BY id`,
    [userId],
  )) as OrderRow[];
  return rows.map(toOrder);
}

async function exitsFor(positionIds: number[]): Promise<Map<number, EngineExit[]>> {
  const map = new Map<number, EngineExit[]>();
  if (positionIds.length === 0) return map;
  const sql = getSql();
  const rows = (await sql`
    SELECT position_id, exit_date::text AS date, exit_price AS price, shares, reason
    FROM paper_exits WHERE position_id = ANY(${positionIds}) ORDER BY id
  `) as (EngineExit & { position_id: number })[];
  for (const r of rows) {
    const list = map.get(r.position_id) ?? [];
    list.push({ date: r.date, price: r.price, shares: r.shares, reason: r.reason });
    map.set(r.position_id, list);
  }
  return map;
}

async function loadPositions(userId: string, status?: "open" | "closed"): Promise<EnginePosition[]> {
  const sql = getSql();
  const rows = (await sql.query(
    `SELECT ${POSITION_COLS} FROM paper_positions WHERE user_id = $1 ${status ? "AND status = $2" : ""} ORDER BY id`,
    status ? [userId, status] : [userId],
  )) as PositionRow[];
  const exits = await exitsFor(rows.map((r) => r.id));
  return rows.map((r) => toPosition(r, exits.get(r.id) ?? []));
}

async function loadCash(userId: string): Promise<Record<Track, number>> {
  const sql = getSql();
  const rows = (await sql`SELECT track, cash FROM paper_accounts WHERE user_id = ${userId}`) as { track: Track; cash: number }[];
  const cash: Record<Track, number> = { auto: 0, manual: 0 };
  for (const r of rows) cash[r.track] = r.cash;
  return cash;
}

/** Each ticker's last `n` bars on or before `date`, oldest first. */
async function loadBarsUntil(tickers: string[], date: string, n: number): Promise<Map<string, Bar[]>> {
  const map = new Map<string, Bar[]>();
  if (tickers.length === 0) return map;
  const sql = getSql();
  const rows = (await sql`
    SELECT ticker, date, o, h, l, c, v FROM (
      SELECT ticker, date::text AS date, o, h, l, c, v::double precision AS v,
        row_number() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
      FROM bars WHERE ticker = ANY(${tickers}) AND date <= ${date}
    ) t WHERE rn <= ${n} ORDER BY ticker, date
  `) as (Bar & { ticker: string })[];
  for (const { ticker, ...bar } of rows) {
    const list = map.get(ticker) ?? [];
    list.push(bar);
    map.set(ticker, list);
  }
  return map;
}

/* ---------- accounts ---------- */

/** Create the user's two ledgers if missing. Called on the first visit to /paper; the nightly job only serves users who have them. */
export async function ensureAccounts(userId: string): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO paper_accounts (user_id, track, cash)
    VALUES (${userId}, 'auto', 0), (${userId}, 'manual', ${P.MANUAL_START_CASH})
    ON CONFLICT (user_id, track) DO NOTHING
  `;
}

/* ---------- nightly ---------- */

export interface PaperNight {
  filled: number;
  stopped: number;
  armed: number;
  cancelled: number;
}

/**
 * Run after the scan for `date` has persisted. For every user with a paper
 * account: advance the book through each session in `bars` after the last one
 * processed (up to and including `date`), then arm tonight's auto orders from
 * the stored payload. `paper_processed_dates` makes a forced rescan a no-op.
 */
export async function runPaperNight(date: string): Promise<PaperNight> {
  const sql = getSql();
  const totals: PaperNight = { filled: 0, stopped: 0, armed: 0, cancelled: 0 };
  const users = (await sql`SELECT DISTINCT user_id FROM paper_accounts`) as { user_id: string }[];
  for (const { user_id: userId } of users) {
    const [{ last }] = (await sql`
      SELECT max(date)::text AS last FROM paper_processed_dates WHERE user_id = ${userId}
    `) as { last: string | null }[];
    const dates = last
      ? ((await sql`SELECT DISTINCT date::text AS date FROM bars WHERE date > ${last} AND date <= ${date} ORDER BY date`) as { date: string }[]).map((r) => r.date)
      : [date];
    let claimedTonight = false;
    for (const d of dates) {
      const claimed = (await sql`
        INSERT INTO paper_processed_dates (user_id, date) VALUES (${userId}, ${d}) ON CONFLICT DO NOTHING RETURNING date
      `) as unknown[];
      if (claimed.length === 0) continue;
      if (d === date) claimedTonight = true;
      const t = await processOneSession(userId, d);
      totals.filled += t.filled;
      totals.stopped += t.stopped;
    }
    if (claimedTonight) {
      const t = await armTonight(userId, date);
      totals.armed += t.armed;
      totals.cancelled += t.cancelled;
    }
  }
  return totals;
}

async function processOneSession(userId: string, date: string): Promise<{ filled: number; stopped: number }> {
  const sql = getSql();
  const orders = await liveOrders(userId);
  const positions = await loadPositions(userId, "open");
  if (orders.length === 0 && positions.length === 0) return { filled: 0, stopped: 0 };
  const cash = await loadCash(userId);
  const tickers = [...new Set([...orders.map((o) => o.ticker), ...positions.map((p) => p.ticker)])];
  const bars = await loadBarsUntil(tickers, date, P.TRAIL_LOOKBACK + 2);
  const r = processSession({ date, bars, orders, positions, cash });

  for (const o of r.orders) {
    const before = orders.find((x) => x.id === o.id)!;
    if (o.status === before.status) continue;
    await sql`
      UPDATE paper_orders SET status = ${o.status}, cancelled_reason = ${o.cancelledReason}, updated_at = now() WHERE id = ${o.id}
    `;
  }
  for (const p of r.positions) {
    if (p.id !== null) continue;
    const [{ id }] = (await sql`
      INSERT INTO paper_positions (user_id, track, ticker, order_id, entry_date, entry_price, shares, initial_stop, current_stop,
        trail_mode, trail_param, pending_sell_shares, peak_close, mfe, mae, late, split_flagged, status, closed_date)
      VALUES (${userId}, ${p.track}, ${p.ticker}, ${p.orderId}, ${p.entryDate}, ${p.entryPrice}, ${p.shares}, ${p.initialStop}, ${p.currentStop},
        ${p.trailMode}, ${p.trailParam}, ${p.pendingSellShares}, ${p.peakClose}, ${p.mfe}, ${p.mae}, ${p.late}, ${p.splitFlagged}, ${p.status}, ${p.closedDate})
      RETURNING id
    `) as { id: number }[];
    p.id = id;
  }
  for (const e of r.events) {
    if (e.type === "exit") {
      await sql`
        INSERT INTO paper_exits (position_id, exit_date, exit_price, shares, reason)
        VALUES (${e.position.id}, ${e.exit.date}, ${e.exit.price}, ${e.exit.shares}, ${e.exit.reason})
      `;
    } else if (e.type === "skip") {
      await sql`INSERT INTO paper_skips (user_id, track, ticker, date, reason) VALUES (${userId}, ${e.track}, ${e.ticker}, ${date}, ${e.reason})`;
    }
  }
  for (const p of r.positions) {
    if (positions.every((x) => x.id !== p.id)) continue; // just inserted above with its final state
    await sql`
      UPDATE paper_positions SET shares = ${p.shares}, current_stop = ${p.currentStop}, pending_sell_shares = ${p.pendingSellShares},
        peak_close = ${p.peakClose}, mfe = ${p.mfe}, mae = ${p.mae}, split_flagged = ${p.splitFlagged},
        status = ${p.status}, closed_date = ${p.closedDate}, updated_at = now()
      WHERE id = ${p.id}
    `;
  }
  for (const track of TRACKS) {
    if (r.cash[track] === cash[track]) continue;
    await sql`UPDATE paper_accounts SET cash = ${r.cash[track]}, updated_at = now() WHERE user_id = ${userId} AND track = ${track}`;
  }
  return countEvents(r.events);
}

function countEvents(events: EngineEvent[]): { filled: number; stopped: number } {
  let filled = 0;
  let stopped = 0;
  for (const e of events) {
    if (e.type === "fill") filled++;
    if (e.type === "exit" && e.exit.reason === "stop") stopped++;
  }
  return { filled, stopped };
}

async function armTonight(userId: string, date: string): Promise<{ armed: number; cancelled: number }> {
  const sql = getSql();
  const rows = (await sql`SELECT payload FROM scan_results WHERE date = ${date}`) as { payload: ScanPayload }[];
  const payload = rows[0]?.payload;
  if (!payload) return { armed: 0, cancelled: 0 };
  const live = (await liveOrders(userId)).filter((o) => o.track === "auto");
  const open = new Set((await loadPositions(userId, "open")).filter((p) => p.track === "auto").map((p) => p.ticker));
  const { arm, cancel } = armDecisions(payload.candidates, live, open);
  const liveByTicker = new Map(live.map((o) => [o.ticker, o]));
  for (const a of arm) {
    const existing = liveByTicker.get(a.ticker);
    if (existing) {
      await sql`UPDATE paper_orders SET trigger_price = ${a.trigger}, stop_price = ${a.stop}, armed_date = ${date}, updated_at = now() WHERE id = ${existing.id}`;
    } else {
      await sql`
        INSERT INTO paper_orders (user_id, track, ticker, trigger_price, stop_price, status, source, armed_date)
        VALUES (${userId}, 'auto', ${a.ticker}, ${a.trigger}, ${a.stop}, 'armed', 'auto', ${date})
      `;
    }
  }
  for (const c of cancel) {
    const o = liveByTicker.get(c.ticker)!;
    await sql`UPDATE paper_orders SET status = 'cancelled', cancelled_reason = ${c.reason}, updated_at = now() WHERE id = ${o.id}`;
  }
  return { armed: arm.length, cancelled: cancel.length };
}

/* ---------- manual-track mutations ---------- */

export type Outcome = { ok: true } | { ok: false; status: number; error: string };

/** Tickers the user has a live manual order or open manual position on — what the deck and watchlist show as "taken". */
export async function manualTakenTickers(userId: string): Promise<string[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT ticker FROM paper_orders WHERE user_id = ${userId} AND track = 'manual' AND status IN ('armed', 'armed_late')
    UNION SELECT ticker FROM paper_positions WHERE user_id = ${userId} AND track = 'manual' AND status = 'open'
  `) as { ticker: string }[];
  return rows.map((r) => r.ticker);
}

/** Place the manual buy-stop. Refuses when one share exceeds the notional or the cash on hand; late when the auto order already filled. */
export async function takeSignal(userId: string, ticker: string, trigger: number, stop: number): Promise<Outcome> {
  if (!(stop < trigger)) return { ok: false, status: 400, error: "the stop must sit below the trigger" };
  await ensureAccounts(userId);
  const sql = getSql();
  const shares = sizeShares(trigger);
  if (shares === 0) return { ok: false, status: 400, error: `one share at ${trigger.toFixed(2)} costs more than the $${P.NOTIONAL} notional` };
  const cash = (await loadCash(userId)).manual;
  const cost = shares * trigger;
  if (cost > cash) return { ok: false, status: 400, error: `insufficient cash: ${shares} shares need $${cost.toFixed(0)}, you have $${cash.toFixed(0)}` };
  const autoOpen = (await sql`
    SELECT 1 FROM paper_positions WHERE user_id = ${userId} AND track = 'auto' AND ticker = ${ticker} AND status = 'open'
  `) as unknown[];
  const status = autoOpen.length > 0 ? "armed_late" : "armed";
  const scan = (await sql`SELECT max(date)::text AS date FROM scan_results`) as { date: string | null }[];
  const armedDate = scan[0]?.date ?? etToday();
  try {
    await sql`
      INSERT INTO paper_orders (user_id, track, ticker, trigger_price, stop_price, status, source, armed_date)
      VALUES (${userId}, 'manual', ${ticker}, ${trigger}, ${stop}, ${status}, 'take', ${armedDate})
    `;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return { ok: false, status: 409, error: `${ticker} is already taken` };
    throw err;
  }
  return { ok: true };
}

async function ownedOpenManual(userId: string, positionId: number): Promise<EnginePosition | null> {
  const sql = getSql();
  const rows = (await sql.query(
    `SELECT ${POSITION_COLS} FROM paper_positions WHERE id = $1 AND user_id = $2 AND track = 'manual' AND status = 'open'`,
    [positionId, userId],
  )) as PositionRow[];
  return rows[0] ? toPosition(rows[0], []) : null;
}

/** Queue a sell of `shares` (default half, at least one) at the next open. */
export async function requestSell(userId: string, positionId: number, shares?: number): Promise<Outcome> {
  const p = await ownedOpenManual(userId, positionId);
  if (!p) return { ok: false, status: 404, error: "no open manual position with that id" };
  const n = shares === undefined ? Math.max(1, Math.floor(p.shares / 2)) : Math.floor(shares);
  if (!(n >= 1 && n <= p.shares)) return { ok: false, status: 400, error: `sell between 1 and ${p.shares} shares` };
  const sql = getSql();
  await sql`UPDATE paper_positions SET pending_sell_shares = ${n}, updated_at = now() WHERE id = ${positionId}`;
  return { ok: true };
}

/** Cancel a queued sell before the night processes it. */
export async function cancelSell(userId: string, positionId: number): Promise<Outcome> {
  const p = await ownedOpenManual(userId, positionId);
  if (!p) return { ok: false, status: 404, error: "no open manual position with that id" };
  const sql = getSql();
  await sql`UPDATE paper_positions SET pending_sell_shares = NULL, updated_at = now() WHERE id = ${positionId}`;
  return { ok: true };
}

/** Raise the stop by hand. Raise only; takes effect from the next session. */
export async function setStop(userId: string, positionId: number, stop: number): Promise<Outcome> {
  const p = await ownedOpenManual(userId, positionId);
  if (!p) return { ok: false, status: 404, error: "no open manual position with that id" };
  if (!(stop > p.currentStop)) return { ok: false, status: 400, error: `the stop can only be raised (now ${p.currentStop.toFixed(2)})` };
  const sql = getSql();
  await sql`UPDATE paper_positions SET current_stop = ${stop}, updated_at = now() WHERE id = ${positionId}`;
  return { ok: true };
}

/** Choose a trail: none, percent below the peak close (param 0–1), or lowest low of the last N sessions. */
export async function setTrail(userId: string, positionId: number, mode: TrailMode, param: number | null): Promise<Outcome> {
  const p = await ownedOpenManual(userId, positionId);
  if (!p) return { ok: false, status: 404, error: "no open manual position with that id" };
  let value: number | null = null;
  if (mode === "percent") {
    if (!(param !== null && param > 0 && param < 1)) return { ok: false, status: 400, error: "percent trail needs a fraction between 0 and 1" };
    value = param;
  } else if (mode === "lowestlow") {
    value = param !== null && param >= 1 ? Math.round(param) : P.TRAIL_LOOKBACK;
  } else if (mode !== "none") {
    return { ok: false, status: 400, error: "trail mode must be none, percent or lowestlow" };
  }
  const sql = getSql();
  await sql`UPDATE paper_positions SET trail_mode = ${mode}, trail_param = ${value}, updated_at = now() WHERE id = ${positionId}`;
  return { ok: true };
}

/* ---------- the book ---------- */

export interface BookOrder {
  id: number;
  ticker: string;
  trigger: number;
  stop: number;
  status: "armed" | "armed_late";
  armedDate: string;
  lastClose: number | null;
}

export interface BookPosition extends EnginePosition {
  id: number;
  lastClose: number | null;
  lastDate: string | null;
  unrealized: number | null;
  unrealizedR: number | null;
  realizedPnl: number;
  realizedR: number;
  /** Stop suggestions for the manual track: the entry day's low and the box bottom from tonight's deck (if still there). */
  entryDayLow: number | null;
  latestBoxBottom: number | null;
}

export interface BookTrack {
  cash: number;
  startCash: number;
  equity: number; // cash + open positions at the last close
  orders: BookOrder[];
  open: BookPosition[];
  closed: BookPosition[];
  stats: TrackStats;
  skips: { ticker: string; date: string; reason: string }[];
}

export type Book = Record<Track, BookTrack> & { asOf: string | null };

export async function getBook(userId: string): Promise<Book> {
  const sql = getSql();
  const cash = await loadCash(userId);
  const orders = await liveOrders(userId);
  const positions = await loadPositions(userId);
  const tickers = [...new Set([...orders.map((o) => o.ticker), ...positions.map((p) => p.ticker)])];
  const last = new Map<string, { date: string; c: number; l: number }>();
  if (tickers.length > 0) {
    const rows = (await sql`
      SELECT DISTINCT ON (ticker) ticker, date::text AS date, c, l FROM bars WHERE ticker = ANY(${tickers}) ORDER BY ticker, date DESC
    `) as { ticker: string; date: string; c: number; l: number }[];
    for (const r of rows) last.set(r.ticker, r);
  }
  const entryLows = new Map<number, number>();
  const openIds = positions.filter((p) => p.status === "open");
  if (openIds.length > 0) {
    const rows = (await sql`
      SELECT p.id, b.l FROM paper_positions p JOIN bars b ON b.ticker = p.ticker AND b.date = p.entry_date
      WHERE p.id = ANY(${openIds.map((p) => p.id)})
    `) as { id: number; l: number }[];
    for (const r of rows) entryLows.set(r.id, r.l);
  }
  const latest = (await sql`SELECT date::text AS date, payload FROM scan_results ORDER BY date DESC LIMIT 1`) as { date: string; payload: ScanPayload }[];
  const boxBottoms = new Map<string, number>();
  for (const c of latest[0]?.payload.candidates ?? []) if (c.box) boxBottoms.set(c.ticker, c.box.bottom);
  const [{ last_processed }] = (await sql`
    SELECT max(date)::text AS last_processed FROM paper_processed_dates WHERE user_id = ${userId}
  `) as { last_processed: string | null }[];
  const skips = (await sql`
    SELECT track, ticker, date::text AS date, reason FROM paper_skips WHERE user_id = ${userId} ORDER BY id DESC LIMIT 50
  `) as { track: Track; ticker: string; date: string; reason: string }[];

  const decorate = (p: EnginePosition): BookPosition => {
    const bar = last.get(p.ticker) ?? null;
    const risk = p.entryPrice - p.initialStop;
    const { pnl, r } = realized(p);
    const unrealized = p.status === "open" && bar ? (bar.c - p.entryPrice) * p.shares : null;
    return {
      ...p,
      id: p.id!,
      lastClose: bar?.c ?? null,
      lastDate: bar?.date ?? null,
      unrealized,
      unrealizedR: unrealized !== null && risk > 0 ? unrealized / (risk * p.shares) : null,
      realizedPnl: pnl,
      realizedR: r,
      entryDayLow: entryLows.get(p.id!) ?? null,
      latestBoxBottom: boxBottoms.get(p.ticker) ?? null,
    };
  };

  const book = { asOf: last_processed } as Book;
  for (const track of TRACKS) {
    const mine = positions.filter((p) => p.track === track).map(decorate);
    const open = mine.filter((p) => p.status === "open");
    const closed = mine.filter((p) => p.status === "closed").sort((a, b) => (b.closedDate ?? "").localeCompare(a.closedDate ?? ""));
    const startCash = track === "manual" ? P.MANUAL_START_CASH : 0;
    book[track] = {
      cash: cash[track],
      startCash,
      equity: cash[track] + open.reduce((s, p) => s + (p.lastClose ?? p.entryPrice) * p.shares, 0),
      orders: orders
        .filter((o) => o.track === track)
        .map((o) => ({
          id: o.id!,
          ticker: o.ticker,
          trigger: o.trigger,
          stop: o.stop,
          status: o.status as BookOrder["status"],
          armedDate: o.armedDate,
          lastClose: last.get(o.ticker)?.c ?? null,
        })),
      open,
      closed,
      stats: computeStats(closed.map((p) => ({ closedDate: p.closedDate!, pnl: p.realizedPnl, r: p.realizedR }))),
      skips: skips.filter((s) => s.track === track),
    };
  }
  return book;
}
