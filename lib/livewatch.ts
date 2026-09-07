// Live watchlist: which watched names are actionable RIGHT NOW. Pull-based —
// computed only when someone looks; the shared quotes table caps Finnhub usage.
import { CONFIG } from "./config";
import { getSql } from "./db";
import { assessMarket } from "./market";
import { getQuotes, LOOKUP_TTL_MS, WATCH_TTL_MS, type Quote } from "./intraday";
import type { MarketHealth } from "./types";

export type WatchStatus = "breaking" | "failed" | "stopped" | "approaching" | "quiet";

/**
 * Classify one watched name from its live quote. Pure; exported for tests.
 * failed = closed above the trigger yesterday (prev close) but trades back under it now —
 * Kullamägi reads a break that does not carry as a failing move.
 */
export function classifyWatch(q: Quote, boxTop: number | null, boxBottom: number | null): WatchStatus {
  if (boxTop === null) return "quiet";
  if (q.c >= boxTop) return "breaking";
  if (q.pc > boxTop) return "failed";
  if (boxBottom !== null && q.c < boxBottom) return "stopped";
  if (q.c >= boxTop * 0.98) return "approaching";
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

export interface LiveWatchRow {
  ticker: string;
  status: WatchStatus;
  price: number;
  boxTop: number | null;
  boxBottom: number | null;
  toTriggerPct: number | null; // (boxTop/price - 1); negative when above
  aboveOpen: boolean;
  dayRangePos: number; // 0 = at low, 1 = at high
}

export interface LiveWatchBundle {
  rows: LiveWatchRow[];
  market: MarketHealth["verdict"] | null;
  asOf: string;
  live: boolean; // false outside market hours (quotes served at the lookup TTL)
}

export async function watchlistLive(): Promise<LiveWatchBundle> {
  const sql = getSql();
  const watch = (await sql`
    SELECT ticker, box_top AS "boxTop", box_bottom AS "boxBottom" FROM watchlist ORDER BY added_at DESC
  `) as { ticker: string; boxTop: number | null; boxBottom: number | null }[];
  const live = inMarketHours(new Date());
  const indices = [...CONFIG.MARKET.INDICES];
  const symbols = [...new Set([...watch.map((w) => w.ticker), ...indices])];
  // Off-hours the prices cannot move, so serve the long TTL and spend no calls.
  const quotes = await getQuotes(symbols, live ? WATCH_TTL_MS : LOOKUP_TTL_MS);

  const rows: LiveWatchRow[] = watch.flatMap((w) => {
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
    }];
  });
  const order: WatchStatus[] = ["breaking", "failed", "stopped", "approaching", "quiet"];
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  // Market verdict from index quotes alone would need bars; reuse the simple leaders check:
  // above previous close on both QQQ and SPY is NOT the filter — leave verdict to the stored
  // scan unless bars are loaded. Cheap live proxy intentionally avoided; see /s live mode.
  const asOf = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })
    .format(new Date());
  void assessMarket; // market strip on this page uses the nightly verdict; full live market lives on /s
  return { rows, market: null, asOf: `${asOf} ET`, live };
}
