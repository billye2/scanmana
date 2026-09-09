// Live status: which names are actionable RIGHT NOW, for the watchlist and for
// tonight's deck. Pull-based — computed only when someone looks; the shared
// quotes table plus a per-poll call budget (CONFIG.LIVE) cap Finnhub usage.
import { CONFIG } from "./config";
import { getSql } from "./db";
import { getQuotes, LOOKUP_TTL_MS, WATCH_TTL_MS, type CachedQuote, type Quote } from "./intraday";
import { latestScan } from "./scan";
import type { Candidate, Verdict } from "./types";

export type WatchStatus = "breaking" | "failed" | "stopped" | "approaching" | "quiet";

/** Fixed display order: what needs a look first. */
export const BUCKET_ORDER: WatchStatus[] = ["breaking", "failed", "stopped", "approaching", "quiet"];

/**
 * Classify one name from its live quote. Pure; exported for tests.
 * failed = closed above the trigger yesterday (prev close) but trades back under it now —
 * Kullamägi reads a break that does not carry as a failing move.
 */
export function classifyWatch(q: Quote, boxTop: number | null, boxBottom: number | null): WatchStatus {
  if (boxTop === null) return "quiet";
  if (q.c >= boxTop) return "breaking";
  if (q.pc > boxTop) return "failed";
  if (boxBottom !== null && q.c < boxBottom) return "stopped";
  if (q.c >= boxTop * (1 - CONFIG.LIVE.APPROACH_PCT)) return "approaching";
  return "quiet";
}

/** Rough US regular session in ET (weekday 9:25–16:05). Pure; exported for tests. */
export function inMarketHours(d: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (["Sat", "Sun"].includes(get("weekday"))) return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 25 && mins <= 16 * 60 + 5;
}

/** What the live read needs to know about a name: its trigger and stop. */
export interface LiveEntry {
  ticker: string;
  boxTop: number | null;
  boxBottom: number | null;
  name?: string;
  verdict?: Verdict;
}

export interface LiveWatchRow {
  ticker: string;
  status: WatchStatus;
  price: number;
  boxTop: number | null;
  boxBottom: number | null;
  toTriggerPct: number | null; // (boxTop/price - 1); negative when above
  aboveOpen: boolean;
  dayRangePos: number; // 0 = at low, 1 = at high
  ageSec: number; // how old this quote is (budget-skipped rows carry an older one)
  name?: string;
  verdict?: Verdict;
}

export interface LiveWatchBundle {
  rows: LiveWatchRow[];
  asOf: string;
  live: boolean; // false outside market hours (quotes served at the lookup TTL)
}

/** Deck candidates carry a box or a bare pivot; the trigger is whichever exists (same rule as ☆ Watch). Pure; exported for tests. */
export function toLiveEntries(candidates: Candidate[]): LiveEntry[] {
  return candidates.map((c) => ({
    ticker: c.ticker,
    boxTop: c.box?.top ?? c.pivot ?? null,
    boxBottom: c.box?.bottom ?? null,
    name: c.name,
    verdict: c.verdict,
  }));
}

/** Rows from entries + quotes, bucket order first, input order within a bucket. Names without a quote are dropped. Pure; exported for tests. */
export function buildLiveRows(entries: LiveEntry[], quotes: Map<string, CachedQuote>, now: number): LiveWatchRow[] {
  const rows = entries.flatMap((w): LiveWatchRow[] => {
    const q = quotes.get(w.ticker);
    if (!q) return [];
    const range = q.h - q.l;
    return [{
      ticker: w.ticker,
      status: classifyWatch(q, w.boxTop, w.boxBottom),
      price: q.c,
      boxTop: w.boxTop,
      boxBottom: w.boxBottom,
      toTriggerPct: w.boxTop !== null ? w.boxTop / q.c - 1 : null,
      aboveOpen: q.c >= q.o,
      dayRangePos: range > 0 ? (q.c - q.l) / range : 0.5,
      ageSec: Math.max(0, Math.round((now - q.fetchedAt) / 1000)),
      ...(w.name !== undefined ? { name: w.name } : {}),
      ...(w.verdict !== undefined ? { verdict: w.verdict } : {}),
    }];
  });
  rows.sort((a, b) => BUCKET_ORDER.indexOf(a.status) - BUCKET_ORDER.indexOf(b.status)); // stable: keeps input order inside a bucket
  return rows;
}

/** Shared engine: live rows for any list of names within a Finnhub call budget. */
export async function liveRows(entries: LiveEntry[], budget: number): Promise<LiveWatchBundle> {
  const live = inMarketHours(new Date());
  const symbols = [...new Set(entries.map((e) => e.ticker))];
  // Off-hours the prices cannot move, so serve the long TTL and spend no calls.
  const quotes = await getQuotes(symbols, live ? WATCH_TTL_MS : LOOKUP_TTL_MS, { maxFetch: budget });
  const now = Date.now();
  const asOf = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })
    .format(new Date(now));
  return { rows: buildLiveRows(entries, quotes, now), asOf: `${asOf} ET`, live };
}

export async function watchlistLive(): Promise<LiveWatchBundle> {
  const sql = getSql();
  const watch = (await sql`
    SELECT ticker, box_top AS "boxTop", box_bottom AS "boxBottom" FROM watchlist ORDER BY added_at DESC
  `) as LiveEntry[];
  return liveRows(watch, CONFIG.LIVE.WATCH_BUDGET);
}

export interface LiveDeckBundle extends LiveWatchBundle {
  date: string | null; // scan date the rows belong to
}

/** Tonight's deck against live quotes — the same read as the watchlist, for every card. */
export async function deckLive(): Promise<LiveDeckBundle> {
  const scan = await latestScan();
  if (!scan) return { rows: [], asOf: "", live: false, date: null };
  const bundle = await liveRows(toLiveEntries(scan.candidates), CONFIG.LIVE.DECK_BUDGET);
  return { ...bundle, date: scan.date };
}
