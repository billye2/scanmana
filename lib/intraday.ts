// Intraday lookup via Finnhub's free /quote endpoint (real-time US quotes,
// 60 calls/min, no volume, no candles). Read-only: the symbol page's Live mode,
// the live watchlist and the live deck all go through getQuotes(); nothing here
// touches the nightly scan or the bars table.
import { CONFIG } from "./config";
import { etToday, isWeekend } from "./dates";
import { assessMarket } from "./market";
import { getSql } from "./db";
import { loadBars } from "./scan";
import type { Bar, MarketHealth } from "./types";

export interface Quote {
  c: number; // current
  o: number; // today's open
  h: number;
  l: number;
  pc: number; // previous close
  t: number; // unix seconds of the quote
}

/** A quote as served from the shared cache: when it was fetched (ms epoch). */
export interface CachedQuote extends Quote {
  fetchedAt: number;
}

export const LOOKUP_TTL_MS = 30 * 60 * 1000; // /s lookup: 30 min (user's choice — budget over freshness)
export const WATCH_TTL_MS = 60 * 1000; // live watchlist + deck: "is the trigger crossing NOW" needs a fresh answer

export type QuoteFetcher = (symbol: string) => Promise<Quote>;

async function fetchFinnhub(symbol: string): Promise<Quote> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not configured");
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`finnhub ${res.status}`);
  const q = (await res.json()) as Quote;
  if (!(q.c > 0) || !(q.o > 0)) throw new Error(`no quote for ${symbol}`);
  return q;
}

export interface CacheRow {
  symbol: string;
  payload: Quote;
  fetchedAt: number; // ms epoch
}

export interface FetchPlan {
  fresh: Map<string, CachedQuote>; // inside the TTL — served as is
  toFetch: string[]; // stale or missing, oldest first, capped at maxFetch
  stale: Map<string, CachedQuote>; // past the TTL but cached — served if not (successfully) refetched
}

/**
 * Decide what one refresh does with a call budget. Symbols never fetched come
 * first (no price at all is worse than an old one), then the oldest cached.
 * Pure; exported for tests.
 */
export function planFetch(symbols: string[], rows: CacheRow[], ttlMs: number, now: number, maxFetch: number): FetchPlan {
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const fresh = new Map<string, CachedQuote>();
  const stale = new Map<string, CachedQuote>();
  const candidates: { symbol: string; fetchedAt: number }[] = [];
  for (const s of symbols) {
    const r = bySymbol.get(s);
    if (r && now - r.fetchedAt < ttlMs) {
      fresh.set(s, { ...r.payload, fetchedAt: r.fetchedAt });
    } else {
      if (r) stale.set(s, { ...r.payload, fetchedAt: r.fetchedAt });
      candidates.push({ symbol: s, fetchedAt: r?.fetchedAt ?? -Infinity });
    }
  }
  candidates.sort((a, b) => a.fetchedAt - b.fetchedAt);
  return { fresh, toFetch: candidates.slice(0, Math.max(0, maxFetch)).map((c) => c.symbol), stale };
}

export interface FetchResult {
  got: Map<string, Quote>;
  halted: boolean; // a 429 stopped the refresh early — remaining symbols were not attempted
}

/**
 * Fetch quotes in bounded batches. One bad symbol drops only itself; a 429
 * (rate limit) stops further batches so the refresh degrades to stale rows
 * instead of hammering the limit. Exported for tests (fetcher is injectable).
 */
export async function fetchMany(symbols: string[], fetcher: QuoteFetcher = fetchFinnhub, batch: number = CONFIG.LIVE.BATCH): Promise<FetchResult> {
  const got = new Map<string, Quote>();
  for (let i = 0; i < symbols.length; i += batch) {
    const slice = symbols.slice(i, i + batch);
    const results = await Promise.allSettled(slice.map((s) => fetcher(s)));
    let limited = false;
    results.forEach((r, j) => {
      if (r.status === "fulfilled") got.set(slice[j], r.value);
      else if (r.reason instanceof Error && r.reason.message === "finnhub 429") limited = true;
    });
    if (limited) return { got, halted: true };
  }
  return { got, halted: false };
}

/**
 * Quotes with a shared cache in the `quotes` Neon table, so the TTL holds
 * globally — across devices, function instances and regions. One Finnhub fetch
 * per symbol per TTL window, total, and never more than `maxFetch` per call:
 * anything past the budget is served stale with its `fetchedAt` so the UI can
 * show the age. Symbols with no quote at all (never fetched, fetch failed) are
 * absent from the map.
 */
export async function getQuotes(
  symbols: string[],
  ttlMs: number,
  opts: { maxFetch?: number } = {},
): Promise<Map<string, CachedQuote>> {
  const sql = getSql();
  const rows = (await sql`
    SELECT symbol, payload, fetched_at FROM quotes WHERE symbol = ANY(${symbols})
  `) as { symbol: string; payload: Quote; fetched_at: string }[];
  const now = Date.now();
  const plan = planFetch(
    symbols,
    rows.map((r) => ({ symbol: r.symbol, payload: r.payload, fetchedAt: new Date(r.fetched_at).getTime() })),
    ttlMs,
    now,
    opts.maxFetch ?? symbols.length,
  );
  const out = new Map(plan.fresh);
  if (plan.toFetch.length > 0) {
    const { got } = await fetchMany(plan.toFetch);
    if (got.size > 0) {
      const entries = [...got].map(([symbol, q]) => ({ symbol, q }));
      await sql`
        INSERT INTO quotes (symbol, payload, fetched_at)
        SELECT e->>'symbol', e->'q', now() FROM jsonb_array_elements(${JSON.stringify(entries)}::jsonb) e
        ON CONFLICT (symbol) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
      `;
      for (const [s, q] of got) out.set(s, { ...q, fetchedAt: now });
    }
  }
  for (const [s, q] of plan.stale) if (!out.has(s)) out.set(s, q); // budget-skipped or failed: old beats nothing
  return out;
}

/**
 * Today's provisional daily bar from a live quote. Finnhub's free quote has no
 * volume, so the bar carries the prior 20-day average — neutral for the
 * volume-ratio checks (dry-up reads ~1x) and labelled as assumed in the UI.
 * Pure; exported for tests.
 */
export function provisionalBar(q: Quote, priorBars: Bar[], date: string): Bar | null {
  if (!(q.c > 0) || !(q.o > 0) || isWeekend(date)) return null;
  const last20 = priorBars.slice(-20);
  const avgVol = last20.length > 0 ? last20.reduce((s, b) => s + b.v, 0) / last20.length : 0;
  return { date, o: q.o, h: Math.max(q.h, q.c), l: Math.min(q.l, q.c), c: q.c, v: Math.round(avgVol) };
}

/** Append today's provisional bar unless the stored history already covers today. Pure; exported for tests. */
export function mergeLive(bars: Bar[], q: Quote, today: string): Bar[] {
  if (bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  if (last.date >= today) return bars; // scan already stored today (or clock skew) — nothing to append
  const bar = provisionalBar(q, bars, today);
  return bar ? [...bars, bar] : bars;
}

export interface LiveBundle {
  bars: Bar[]; // symbol history + provisional today
  market: MarketHealth | undefined; // recomputed with live index bars
  asOf: string; // "3:42 PM ET"
  provisional: boolean; // false when the stored history already covers today
}

/** Live view of one symbol: 4 cached quotes (symbol + index ETFs), provisional bars, live market filter. */
export async function liveBundle(ticker: string): Promise<LiveBundle> {
  const today = etToday();
  const indices = [...CONFIG.MARKET.INDICES];
  const barsByTicker = await loadBars([ticker, ...indices]);
  const symBars = barsByTicker.get(ticker) ?? [];
  const quotes = await getQuotes([ticker, ...indices], LOOKUP_TTL_MS);
  const symQuote = quotes.get(ticker);
  if (!symQuote) throw new Error(`no quote for ${ticker}`);

  const liveBars = mergeLive(symBars, symQuote, today);
  const liveIndexMap = new Map<string, Bar[]>();
  indices.forEach((t) => {
    const q = quotes.get(t);
    const bars = barsByTicker.get(t) ?? [];
    liveIndexMap.set(t, q ? mergeLive(bars, q, today) : bars);
  });

  const asOf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(symQuote.t > 0 ? symQuote.t * 1000 : Date.now()));
  return {
    bars: liveBars,
    market: assessMarket(liveIndexMap) ?? undefined,
    asOf: `${asOf} ET`,
    provisional: liveBars.length > symBars.length,
  };
}
