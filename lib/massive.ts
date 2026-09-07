// Client for Massive (formerly Polygon.io) REST API — free Basic tier.
// Grouped-daily = the whole US market's OHLCV for one date in a single call.

import type { Bar } from "./types";

const BASE = process.env.MASSIVE_BASE_URL ?? "https://api.polygon.io";

function apiKey(): string {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("MASSIVE_API_KEY is not set");
  return key;
}

export class RateLimitError extends Error {
  constructor() {
    super("Massive API rate limit hit (free tier: 5 calls/min)");
  }
}

const RETRIES = 4;

// One request with retries for transient failures: dropped sockets (undici
// "terminated" / "other side closed"), 5xx, and 429 (wait out the minute).
// 4xx other than 429 are permanent and thrown immediately.
async function get(url: string): Promise<Record<string, unknown>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        if (attempt === RETRIES) throw new RateLimitError();
        await sleep(61_000);
        continue;
      }
      if (!res.ok) throw new Error(`Massive API ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const permanent = /Massive API 4\d\d/.test(msg) || err instanceof RateLimitError;
      if (permanent || attempt === RETRIES) throw err;
      const wait = 2_000 * 2 ** attempt;
      console.warn(`massive: ${msg} — retry ${attempt + 1}/${RETRIES} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export interface GroupedBar {
  T: string; // ticker
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** All US stocks' OHLCV for one trading date. Empty array on holidays/weekends. */
export async function fetchGroupedDaily(date: string): Promise<GroupedBar[]> {
  const url = `${BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${apiKey()}`;
  let json: Record<string, unknown>;
  try {
    json = await get(url);
  } catch (err) {
    // Free tier refuses the current ET date until Massive's end-of-day cutoff:
    // 403 NOT_AUTHORIZED "Attempted to request today's data before end of day".
    // That's "no data yet", not a failure — callers walk back to the prior day.
    if (err instanceof Error && err.message.includes("403") && /before end of day/i.test(err.message)) return [];
    throw err;
  }
  return (json.results as GroupedBar[]) ?? [];
}

export interface TickerRef {
  ticker: string;
  name: string;
  type: string;
}

/** Reference tickers of one type (CS = common stock, ADRC = ADR), fully paginated. */
export async function fetchTickers(
  type: "CS" | "ADRC",
  throttleMs = 12_500,
): Promise<TickerRef[]> {
  const out: TickerRef[] = [];
  let url: string | null =
    `${BASE}/v3/reference/tickers?market=stocks&active=true&type=${type}&limit=1000&apiKey=${apiKey()}`;
  while (url) {
    const json: Record<string, unknown> = await get(url);
    const results = (json.results as { ticker: string; name?: string; type?: string }[]) ?? [];
    for (const r of results) out.push({ ticker: r.ticker, name: r.name ?? r.ticker, type: r.type ?? type });
    const next = json.next_url as string | undefined;
    url = next ? `${next}&apiKey=${apiKey()}` : null;
    if (url) await sleep(throttleMs); // stay under 5 calls/min
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Daily bars for one ticker over a date range (one call, up to 5000 bars). */
export async function fetchDailyRange(ticker: string, from: string, to: string): Promise<Bar[]> {
  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${apiKey()}`;
  const json = await get(url);
  const results = (json.results as { t: number; o: number; h: number; l: number; c: number; v: number }[]) ?? [];
  return results.map((r) => ({
    date: new Date(r.t).toISOString().slice(0, 10),
    o: r.o,
    h: r.h,
    l: r.l,
    c: r.c,
    v: r.v,
  }));
}
