import { CONFIG } from "./config";
import { findDarvasBox } from "./darvas";
import {
  adrPct,
  avgDollarVolume,
  detectEp,
  distFromHigh,
  lastClose,
  pctReturn,
  sma,
  smaRising,
  tightness,
} from "./indicators";
import { findPivot } from "./livermore";
import type { Bar, Candidate } from "./types";

/**
 * Compute every Candidate field for a ticker without applying the screen's
 * hard filters. Null only when there isn't enough history. Used by the symbol
 * page for watchlisted names that aren't in tonight's deck.
 */
export function buildCandidate(ticker: string, name: string, bars: Bar[]): Candidate | null {
  if (bars.length < CONFIG.MIN_BARS) return null;
  const price = lastClose(bars);
  const dollarVol = avgDollarVolume(bars, CONFIG.ADR_WINDOW);
  const ret1m = pctReturn(bars, CONFIG.LOOKBACK.M1);
  const ret3m = pctReturn(bars, CONFIG.LOOKBACK.M3);
  const ret6m = pctReturn(bars, CONFIG.LOOKBACK.M6);
  const adr = adrPct(bars, CONFIG.ADR_WINDOW);
  const dist = distFromHigh(bars, CONFIG.HIGH_LOOKBACK);
  if (dollarVol === null || ret1m === null || ret3m === null || ret6m === null || adr === null || dist === null) return null;
  const tight = tightness(bars, CONFIG.TIGHTNESS_WINDOW, adr);
  if (tight === null) return null;
  return {
    ticker,
    name,
    price,
    dollarVol,
    ret1m,
    ret3m,
    ret6m,
    adrPct: adr,
    distFromHigh: dist,
    tightness: tight,
    box: findDarvasBox(bars),
    pivot: findPivot(bars),
    ep: detectEp(bars, CONFIG.EP),
    bars: bars.slice(-CONFIG.CHART_BARS),
  };
}

export interface ScreenCheck {
  label: string;
  ok: boolean;
  detail: string; // the number behind the verdict, e.g. "$50.33 ≥ $5"
}

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n.toFixed(2)}`);
const pc = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`; // signed, for returns
const th = (n: number) => `${(n * 100).toFixed(0)}%`; // unsigned, for thresholds

/**
 * Every hard filter of the Qullamaggie breakout screen, as a checklist with the
 * numbers behind each verdict. `screenTicker` is exactly "all of these pass" —
 * the symbol page uses the list to show WHY a name is or isn't in the deck.
 */
export function explainScreen(c: Candidate, bars: Bar[]): ScreenCheck[] {
  const smaFast = sma(bars, CONFIG.SMA_FAST);
  const smaSlow = sma(bars, CONFIG.SMA_SLOW);
  const lowClose = Math.min(...bars.slice(-CONFIG.MIN_PRICE_WINDOW).map((b) => b.c));
  const momentumOk = c.ret1m >= CONFIG.MOMENTUM.M1 || c.ret3m >= CONFIG.MOMENTUM.M3 || c.ret6m >= CONFIG.MOMENTUM.M6;
  return [
    { label: `Price ≥ $${CONFIG.MIN_PRICE}`, ok: c.price >= CONFIG.MIN_PRICE, detail: usd(c.price) },
    { label: `Dollar volume ≥ ${usd(CONFIG.MIN_DOLLAR_VOLUME)}/day`, ok: c.dollarVol >= CONFIG.MIN_DOLLAR_VOLUME, detail: `${usd(c.dollarVol)}/day (20-day avg)` },
    {
      label: `Momentum: 1M ≥ ${th(CONFIG.MOMENTUM.M1)} or 3M ≥ ${th(CONFIG.MOMENTUM.M3)} or 6M ≥ ${th(CONFIG.MOMENTUM.M6)}`,
      ok: momentumOk,
      detail: `1M ${pc(c.ret1m)} · 3M ${pc(c.ret3m)} · 6M ${pc(c.ret6m)}`,
    },
    { label: `ADR ≥ ${CONFIG.MIN_ADR_PCT}% (moves enough to pay)`, ok: c.adrPct >= CONFIG.MIN_ADR_PCT, detail: `ADR ${c.adrPct.toFixed(1)}%` },
    { label: `ADR ≤ ${CONFIG.MAX_ADR_PCT}% (not parabolic)`, ok: c.adrPct <= CONFIG.MAX_ADR_PCT, detail: `ADR ${c.adrPct.toFixed(1)}%` },
    { label: `1M return ≤ ${th(CONFIG.MAX_RET_1M)} (has a base)`, ok: c.ret1m <= CONFIG.MAX_RET_1M, detail: `1M ${pc(c.ret1m)}` },
    { label: `Every close of the last ${CONFIG.MIN_PRICE_WINDOW} sessions ≥ $${CONFIG.MIN_PRICE}`, ok: lowClose >= CONFIG.MIN_PRICE, detail: `lowest close ${usd(lowClose)}` },
    {
      label: `Price above the ${CONFIG.SMA_FAST}- and ${CONFIG.SMA_SLOW}-day averages`,
      ok: smaFast !== null && smaSlow !== null && c.price > smaFast && c.price > smaSlow,
      detail: smaFast === null || smaSlow === null ? "not enough bars" : `${usd(c.price)} vs ${CONFIG.SMA_FAST}d ${usd(smaFast)} · ${CONFIG.SMA_SLOW}d ${usd(smaSlow)}`,
    },
    {
      label: `${CONFIG.SMA_FAST}- and ${CONFIG.SMA_SLOW}-day averages rising (vs ${CONFIG.SMA_SLOPE_LOOKBACK} sessions ago)`,
      ok: smaRising(bars, CONFIG.SMA_FAST, CONFIG.SMA_SLOPE_LOOKBACK) && smaRising(bars, CONFIG.SMA_SLOW, CONFIG.SMA_SLOPE_LOOKBACK),
      detail: `${CONFIG.SMA_FAST}d ${smaRising(bars, CONFIG.SMA_FAST, CONFIG.SMA_SLOPE_LOOKBACK) ? "rising" : "not rising"} · ${CONFIG.SMA_SLOW}d ${smaRising(bars, CONFIG.SMA_SLOW, CONFIG.SMA_SLOPE_LOOKBACK) ? "rising" : "not rising"}`,
    },
    { label: `Within ${th(CONFIG.MAX_DIST_FROM_HIGH)} of the 6-month high`, ok: c.distFromHigh <= CONFIG.MAX_DIST_FROM_HIGH, detail: `${pc(-c.distFromHigh)} from the high` },
  ];
}

/**
 * Full Qullamaggie breakout screen for one ticker.
 * Returns a Candidate when every hard filter passes, else null.
 */
export function screenTicker(ticker: string, name: string, bars: Bar[]): Candidate | null {
  const c = buildCandidate(ticker, name, bars);
  if (!c) return null;
  return explainScreen(c, bars).every((k) => k.ok) ? c : null;
}

/** Boxed setups first (there is a level to trade), tightest first within each group, capped at MAX_RESULTS. */
export function rankCandidates(candidates: Candidate[]): Candidate[] {
  return [...candidates]
    .sort((a, b) => Number(!a.box) - Number(!b.box) || a.tightness - b.tightness)
    .slice(0, CONFIG.MAX_RESULTS);
}
