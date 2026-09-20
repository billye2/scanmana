// scan_history: the per-night record the research layer (research/*.py) reads.
// One row per ticker that passed the loose screen (lib/screen.ts LOOSE_LIMITS),
// with the metrics every sweep threshold is a filter on, the deck rank for the
// real screen, and the analysis verdict + which frameworks objected.
import { getSql } from "./db";
import { readVcp } from "./minervini";
import type { Analysis, Candidate, MarketHealth } from "./types";

export interface HistoryRow {
  ticker: string;
  basePass: boolean;
  rank: number | null;
  verdict: Analysis["overall"];
  objections: string[];
  close: number;
  dollarVol: number;
  adrPct: number;
  distFromHigh: number;
  ret1m: number;
  ret3m: number;
  ret6m: number;
  tightness: number;
  boxed: boolean;
  boxTop: number | null;
  boxBottom: number | null;
  pivot: number | null;
  ep: boolean;
  vcp: boolean;
  marketBullish: boolean | null;
}

const FRAMEWORKS = ["qullamaggie", "livermore", "darvas", "minervini"] as const;

/** Names of the frameworks whose read was "pass" — the analysis's objections. Pure. */
export function objections(a: Analysis): string[] {
  return FRAMEWORKS.filter((k) => a[k]?.verdict === "pass");
}

/** The VCP badge: the base contracts and the last pullback is shallow — the same read the symbol page shows. Pure. */
export function hasVcp(c: Candidate): boolean {
  const v = readVcp(c.bars);
  return !!v && v.shrinking;
}

export function toHistoryRow(
  c: Candidate,
  a: Analysis,
  basePass: boolean,
  rank: number | null,
  market: MarketHealth | undefined,
): HistoryRow {
  return {
    ticker: c.ticker,
    basePass,
    rank,
    verdict: a.overall,
    objections: objections(a),
    close: c.price,
    dollarVol: c.dollarVol,
    adrPct: c.adrPct,
    distFromHigh: c.distFromHigh,
    ret1m: c.ret1m,
    ret3m: c.ret3m,
    ret6m: c.ret6m,
    tightness: c.tightness,
    boxed: !!c.box,
    boxTop: c.box?.top ?? null,
    boxBottom: c.box?.bottom ?? null,
    pivot: c.pivot,
    ep: !!c.ep,
    vcp: hasVcp(c),
    marketBullish: market ? market.verdict === "bullish" : null,
  };
}

/** Replace the night's rows (a rescan can change the set), 200 per statement. */
export async function upsertScanHistory(date: string, rows: HistoryRow[]): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM scan_history WHERE date = ${date}`;
  const COLS = 21;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * COLS;
      values.push(`(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(",")})`);
      params.push(
        date, r.ticker, r.basePass, r.rank, r.verdict, r.objections, r.close, r.dollarVol, r.adrPct,
        r.distFromHigh, r.ret1m, r.ret3m, r.ret6m, r.tightness, r.boxed, r.boxTop, r.boxBottom, r.pivot,
        r.ep, r.vcp, r.marketBullish,
      );
    });
    await sql.query(
      `INSERT INTO scan_history (date, ticker, base_pass, rank, verdict, objections, close, dollar_vol, adr_pct,
         dist_from_high, ret_1m, ret_3m, ret_6m, tightness, boxed, box_top, box_bottom, pivot, ep, vcp, market_bullish)
       VALUES ${values.join(",")}
       ON CONFLICT (date, ticker) DO UPDATE SET
         base_pass = EXCLUDED.base_pass, rank = EXCLUDED.rank, verdict = EXCLUDED.verdict, objections = EXCLUDED.objections,
         close = EXCLUDED.close, dollar_vol = EXCLUDED.dollar_vol, adr_pct = EXCLUDED.adr_pct, dist_from_high = EXCLUDED.dist_from_high,
         ret_1m = EXCLUDED.ret_1m, ret_3m = EXCLUDED.ret_3m, ret_6m = EXCLUDED.ret_6m, tightness = EXCLUDED.tightness,
         boxed = EXCLUDED.boxed, box_top = EXCLUDED.box_top, box_bottom = EXCLUDED.box_bottom, pivot = EXCLUDED.pivot,
         ep = EXCLUDED.ep, vcp = EXCLUDED.vcp, market_bullish = EXCLUDED.market_bullish, created_at = now()`,
      params,
    );
  }
}
