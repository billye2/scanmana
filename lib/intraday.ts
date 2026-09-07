// Intraday lookup via Finnhub's free /quote endpoint (real-time US quotes,
// 60 calls/min, no volume, no candles). Used only by the symbol page's Live
// mode — read-only, never touches the nightly scan or the DB.
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

export const LOOKUP_TTL_MS = 30 * 60 * 1000; // /s lookup: 30 min (user's choice — budget over freshness)
export const WATCH_TTL_MS = 60 * 1000; // live watchlist: "is the trigger crossing NOW" needs a fresh answer

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

/**
 * Quotes with a shared cache in the `quotes` Neon table, so the TTL holds
 * globally — across devices, function instances and regions. One Finnhub fetch
 * per symbol per TTL window, total.
 */
export async function getQuotes(symbols: string[], ttlMs: number): Promise<Map<string, Quote>> {
  const sql = getSql();
  const rows = (await sql`
    SELECT symbol, payload, fetched_at FROM quotes WHERE symbol = ANY(${symbols})
  `) as { symbol: string; payload: Quote; fetched_at: string }[];
  const out = new Map<string, Quote>();
  const now = Date.now();
  for (const r of rows) if (now - new Date(r.fetched_at).getTime() < ttlMs) out.set(r.symbol, r.payload);
  const stale = symbols.filter((s) => !out.has(s));
  await Promise.all(
    stale.map(async (s) => {
      const q = await fetchFinnhub(s);
      out.set(s, q);
      await sql`
        INSERT INTO quotes (symbol, payload, fetched_at) VALUES (${s}, ${JSON.stringify(q)}::jsonb, now())
        ON CONFLICT (symbol) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
      `;
    }),
  );
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
  const symQuote = quotes.get(ticker)!;

  const liveBars = mergeLive(symBars, symQuote, today);
  const liveIndexMap = new Map<string, Bar[]>();
  indices.forEach((t) => liveIndexMap.set(t, mergeLive(barsByTicker.get(t) ?? [], quotes.get(t)!, today)));

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
