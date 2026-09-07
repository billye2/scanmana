import { CONFIG } from "./config";
import { lastClose, sma, smaRising } from "./indicators";
import type { Bar, IndexHealth, MarketHealth, MarketVerdict } from "./types";

/** Position of one index against its moving averages. Null if not enough bars. */
export function indexHealth(ticker: string, bars: Bar[]): IndexHealth | null {
  const need = Math.max(...CONFIG.MARKET.SMAS) + CONFIG.MARKET.SLOPE_LOOKBACK;
  if (bars.length < need) return null;
  const close = lastClose(bars);
  const smas = CONFIG.MARKET.SMAS.map((period) => {
    const value = sma(bars, period)!;
    return { period, value, above: close > value, rising: smaRising(bars, period, CONFIG.MARKET.SLOPE_LOOKBACK) };
  });
  const fast = smas.find((s) => s.period === 10)!.value;
  const slow = smas.find((s) => s.period === 20)!.value;
  return { ticker, close, smas, fastOverSlow: fast > slow };
}

/**
 * Kullamägi's market filter as a yes/no. His stated metric: breakouts and EPs
 * work while the index's 10-day average is above its 20-day; when the 10
 * crosses under the 20, step aside. "All averages confirming" adds: price above
 * the 20 and 50, and the 10/20/50 all rising. A dip under the 10-day alone does
 * not flip the verdict. Anything less is "not bullish"; the reason says why.
 */
export function assessMarket(barsByTicker: Map<string, Bar[]>): MarketHealth | null {
  const indices: IndexHealth[] = [];
  for (const t of CONFIG.MARKET.INDICES) {
    const bars = barsByTicker.get(t);
    const h = bars ? indexHealth(t, bars) : null;
    if (h) indices.push(h);
  }
  const leaders = indices.filter((i) => (CONFIG.MARKET.LEADERS as readonly string[]).includes(i.ticker));
  if (leaders.length === 0) return null;

  const failing = leaders.flatMap((i) => {
    const out: string[] = [];
    if (!i.fastOverSlow) out.push(`${i.ticker} 10d below 20d`);
    for (const s of i.smas) {
      if (s.period !== 10 && !s.above) out.push(`${i.ticker} below ${s.period}d`);
      if (!s.rising) out.push(`${i.ticker} ${s.period}d falling`);
    }
    return out;
  });
  const names = leaders.map((i) => i.ticker).join(" and ");
  const verdict: MarketVerdict = failing.length === 0 ? "bullish" : "not-bullish";
  const reason =
    verdict === "bullish"
      ? `${names}: 10-day above 20-day, price above the 20 and 50, all rising — green light for breakouts`
      : `${failing.join(", ")} — breakouts fail more often here; size down or wait`;
  return { verdict, reason, indices };
}
