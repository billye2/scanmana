// Replay the screen over every stored session and fill scan_history, the input
// of the research layer (research/outcomes.py needs history to label). The
// nightly scan appends its own row set from now on; this is the one-time
// catch-up for the ~250 sessions already in `bars`. Resume-safe: dates that
// already have scan_history rows are skipped unless --force.
// Usage: npm run backfill:scans            (every session with enough history)
//        npm run backfill:scans -- --days 120
//        npm run backfill:scans -- --force
// COIL_DATABASE_URL is injected per-process by `vercel env run` (see package.json).
import { CONFIG } from "../lib/config";
import { getSql } from "../lib/db";
import { analyzeCandidate } from "../lib/analysis";
import { assessMarket } from "../lib/market";
import { loadBars } from "../lib/scan";
import { toHistoryRow, upsertScanHistory, type HistoryRow } from "../lib/scan-history";
import { LOOSE_LIMITS, rankCandidates, screenBoth } from "../lib/screen";
import type { Bar, Candidate } from "../lib/types";

const INDEX_TICKERS = new Set<string>(CONFIG.MARKET.INDICES);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "true") : undefined;
}

/** The SQL prefilter of lib/scan.ts, in JS, on bars truncated at one date. */
function prefilter(bars: Bar[]): boolean {
  const n = bars.length;
  if (n < CONFIG.LOOKBACK.M6 + 1) return false;
  const c0 = bars[n - 1].c;
  if (c0 < LOOSE_LIMITS.MIN_PRICE) return false;
  let adv = 0;
  for (let i = n - 20; i < n; i++) adv += bars[i].c * bars[i].v;
  if (adv / 20 < LOOSE_LIMITS.MIN_DOLLAR_VOLUME) return false;
  const c1 = bars[n - 1 - CONFIG.LOOKBACK.M1].c;
  const c3 = bars[n - 1 - CONFIG.LOOKBACK.M3].c;
  const c6 = bars[n - 1 - CONFIG.LOOKBACK.M6].c;
  if (!(c1 > 0 && c3 > 0 && c6 > 0)) return false;
  return c0 / c1 - 1 >= CONFIG.MOMENTUM.M1 || c0 / c3 - 1 >= CONFIG.MOMENTUM.M3 || c0 / c6 - 1 >= CONFIG.MOMENTUM.M6;
}

/** Index of `date` in ascending bars, or -1 when that session is missing for the ticker. */
function indexOfDate(bars: Bar[], date: string): number {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = bars[mid].date;
    if (d === date) return mid;
    if (d < date) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

async function main() {
  const sql = getSql();
  const force = arg("--force") !== undefined;
  const days = Number(arg("--days") ?? 0);

  const tickerRows = (await sql`SELECT ticker, name FROM tickers WHERE active`) as { ticker: string; name: string }[];
  const names = new Map(tickerRows.map((t) => [t.ticker, t.name]));
  console.log(`loading bars for ${names.size} tickers + indices…`);
  const barsByTicker = await loadBars([...names.keys(), ...INDEX_TICKERS]);
  console.log(`loaded ${[...barsByTicker.values()].reduce((s, b) => s + b.length, 0)} bars`);

  // Sessions = the dates the index ETFs have (seeded by scripts/seed-indices.ts), else the union.
  const dateSet = new Set<string>();
  const spine = [...INDEX_TICKERS].map((t) => barsByTicker.get(t) ?? []).find((b) => b.length > 0);
  if (spine) for (const b of spine) dateSet.add(b.date);
  else for (const bars of barsByTicker.values()) for (const b of bars) dateSet.add(b.date);
  let dates = [...dateSet].sort();
  dates = dates.slice(CONFIG.MIN_BARS - 1); // the first sessions cannot have 6 months of history
  if (days > 0) dates = dates.slice(-days);

  const done = new Set(
    ((await sql`SELECT DISTINCT date::text AS date FROM scan_history`) as { date: string }[]).map((r) => r.date),
  );
  const todo = dates.filter((d) => force || !done.has(d));
  console.log(`${todo.length} sessions to replay (${dates.length - todo.length} already done)`);

  let n = 0;
  for (const date of todo) {
    const t0 = Date.now();
    const indexBars = new Map<string, Bar[]>();
    for (const t of INDEX_TICKERS) {
      const bars = barsByTicker.get(t);
      const i = bars ? indexOfDate(bars, date) : -1;
      if (bars && i >= 0) indexBars.set(t, bars.slice(0, i + 1));
    }
    const market = assessMarket(indexBars) ?? undefined;

    const loose: { candidate: Candidate; basePass: boolean }[] = [];
    for (const [ticker, bars] of barsByTicker) {
      if (INDEX_TICKERS.has(ticker)) continue;
      const i = indexOfDate(bars, date);
      if (i < CONFIG.MIN_BARS - 1) continue;
      const upTo = bars.slice(0, i + 1);
      if (!prefilter(upTo)) continue;
      const r = screenBoth(ticker, names.get(ticker) ?? ticker, upTo);
      if (r) loose.push(r);
    }
    const ranked = rankCandidates(loose.filter((r) => r.basePass).map((r) => r.candidate));
    const rankOf = new Map(ranked.map((c, i) => [c.ticker, i + 1]));
    const rows: HistoryRow[] = loose.map(({ candidate: c, basePass }) =>
      toHistoryRow(c, analyzeCandidate(c, market), basePass, rankOf.get(c.ticker) ?? null, market),
    );
    await upsertScanHistory(date, rows);
    n++;
    console.log(`${date}: ${rows.length} loose · ${ranked.length} deck · ${((Date.now() - t0) / 1000).toFixed(1)}s (${n}/${todo.length})`);
  }
  console.log("scan history backfill complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
