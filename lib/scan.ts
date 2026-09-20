import { CONFIG } from "./config";
import { addDays, etToday, isWeekend } from "./dates";
import { getSql } from "./db";
import { analyzeCandidate } from "./analysis";
import { assessMarket } from "./market";
import { fetchGroupedDaily, fetchTickers, sleep, type GroupedBar } from "./massive";
import { LOOSE_LIMITS, rankCandidates, screenBoth } from "./screen";
import { toHistoryRow, upsertScanHistory, type HistoryRow } from "./scan-history";
import type { DeckCard, Analysis, Bar, Candidate, ScanPayload, WatchlistAlert } from "./types";

const TICKER_REFRESH_DAYS = 7;
const MIN_MARKET_BARS = 1000; // fewer grouped rows than this => holiday / data not ready
const INDEX_TICKERS = new Set<string>(CONFIG.MARKET.INDICES);

export type ScanResult =
  | { status: "ok"; date: string; newSetups: number; watchlistAlerts: number }
  | { status: "skipped"; reason: string; date?: string };

export async function runScan(opts: { force?: boolean } = {}): Promise<ScanResult> {
  const sql = getSql();

  await refreshTickersIfStale();
  const tickerRows = (await sql`SELECT ticker, name FROM tickers WHERE active`) as {
    ticker: string;
    name: string;
  }[];
  const names = new Map(tickerRows.map((t) => [t.ticker, t.name]));

  // 1. Find the latest trading day with published data (walk back from today ET).
  let date = etToday();
  let grouped: GroupedBar[] = [];
  for (let i = 0; i < 7; i++) {
    if (!isWeekend(date)) {
      grouped = await fetchGroupedDaily(date);
      if (grouped.length >= MIN_MARKET_BARS) break;
      grouped = [];
      await sleep(12_500); // free tier: 5 calls/min
    }
    date = addDays(date, -1);
  }
  if (grouped.length === 0) return { status: "skipped", reason: "no trading data found in the last 7 days" };

  // 2. Already scanned?
  if (!opts.force) {
    const existing = (await sql`SELECT date FROM scan_results WHERE date = ${date}`) as unknown[];
    if (existing.length > 0) return { status: "skipped", reason: "already scanned", date };
  }

  // 3. Upsert the day's bars for known tickers (plus the market-health index ETFs).
  const dayBars = grouped.filter((g) => names.has(g.T) || INDEX_TICKERS.has(g.T));
  await upsertBars(date, dayBars);
  await sql`DELETE FROM bars WHERE date < CURRENT_DATE - ${CONFIG.PRUNE_DAYS}::int`;

  // 4. Coarse SQL prefilter: price, dollar volume, momentum — shrinks 4k tickers to a few hundred.
  //    Floors are the LOOSE ones: the JS screen below applies the real CONFIG, and the
  //    loose passers are recorded in scan_history for the research sweep.
  const prefiltered = (await sql`
    WITH ranked AS (
      SELECT ticker, c, v, row_number() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
      FROM bars
    ),
    agg AS (
      SELECT ticker,
        max(c) FILTER (WHERE rn = 1) AS c0,
        max(c) FILTER (WHERE rn = ${CONFIG.LOOKBACK.M1 + 1}) AS c1m,
        max(c) FILTER (WHERE rn = ${CONFIG.LOOKBACK.M3 + 1}) AS c3m,
        max(c) FILTER (WHERE rn = ${CONFIG.LOOKBACK.M6 + 1}) AS c6m,
        avg(c * v) FILTER (WHERE rn <= 20) AS adv
      FROM ranked
      WHERE rn <= ${CONFIG.LOOKBACK.M6 + 1}
      GROUP BY ticker
    )
    SELECT ticker FROM agg
    WHERE ticker <> ALL(${[...INDEX_TICKERS]})
      AND c0 >= ${LOOSE_LIMITS.MIN_PRICE}
      AND adv >= ${LOOSE_LIMITS.MIN_DOLLAR_VOLUME}
      AND c6m IS NOT NULL AND c1m > 0 AND c3m > 0 AND c6m > 0
      AND (c0 / c1m - 1 >= ${CONFIG.MOMENTUM.M1}
        OR c0 / c3m - 1 >= ${CONFIG.MOMENTUM.M3}
        OR c0 / c6m - 1 >= ${CONFIG.MOMENTUM.M6})
  `) as { ticker: string }[];

  // 5. Full JS screen on the survivors — once per ticker, two verdicts (real deck / loose history).
  const candidates: Candidate[] = [];
  const loose: { candidate: Candidate; basePass: boolean }[] = [];
  const watchRows = (await sql`SELECT ticker, box_top FROM watchlist`) as {
    ticker: string;
    box_top: number | null;
  }[];
  const wanted = new Set<string>([
    ...prefiltered.map((r) => r.ticker),
    ...watchRows.map((r) => r.ticker),
    ...INDEX_TICKERS,
  ]);
  const barsByTicker = await loadBars([...wanted]);

  for (const t of prefiltered) {
    const bars = barsByTicker.get(t.ticker);
    if (!bars) continue;
    const r = screenBoth(t.ticker, names.get(t.ticker) ?? t.ticker, bars);
    if (!r) continue;
    loose.push(r);
    if (r.basePass) candidates.push(r.candidate);
  }
  const ranked = rankCandidates(candidates);

  // 6. Watchlist box-break alerts.
  const watchlistAlerts: WatchlistAlert[] = [];
  for (const w of watchRows) {
    if (w.box_top === null) continue;
    const bars = barsByTicker.get(w.ticker);
    const last = bars?.[bars.length - 1];
    if (last && last.date === date && (last.c > w.box_top || last.h > w.box_top)) {
      watchlistAlerts.push({ ticker: w.ticker, boxTop: w.box_top, close: last.c, high: last.h });
    }
  }

  // 7. Market health from the index ETFs (null until scripts/seed-indices.ts has run).
  const market = assessMarket(barsByTicker) ?? undefined;

  // 8. Per-candidate framework analysis (rule-based, lib/analysis.ts); stamp the verdict on the card.
  const analyses = ranked.map((c) => analyzeCandidate(c, market));
  ranked.forEach((c, i) => (c.verdict = analyses[i].overall));

  // 8b. scan_history rows for every loose passer: the deck's own analysis where it
  //     exists, a fresh (identical, pure) one for the rest. Read by research/*.py.
  const rankOf = new Map(ranked.map((c, i) => [c.ticker, i + 1]));
  const analysisOf = new Map(analyses.map((a) => [a.ticker, a]));
  const history: HistoryRow[] = loose.map(({ candidate: c, basePass }) =>
    toHistoryRow(c, analysisOf.get(c.ticker) ?? analyzeCandidate(c, market), basePass, rankOf.get(c.ticker) ?? null, market),
  );

  // 9. Persist.
  const payload: ScanPayload = {
    date,
    generatedAt: new Date().toISOString(),
    candidates: ranked,
    watchlistAlerts,
    market,
  };
  await sql`
    INSERT INTO scan_results (date, payload) VALUES (${date}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (date) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()
  `;
  await upsertAnalyses(date, analyses);
  // Research input only — a failure here (e.g. migration not applied yet) must not fail the scan.
  try {
    await upsertScanHistory(date, history);
  } catch (err) {
    console.error("scan_history write failed:", err);
  }

  return { status: "ok", date, newSetups: ranked.length, watchlistAlerts: watchlistAlerts.length };
}

async function refreshTickersIfStale(): Promise<void> {
  const sql = getSql();
  const rows = (await sql`
    SELECT count(*)::int AS n, max(updated_at) AS latest FROM tickers
  `) as { n: number; latest: string | null }[];
  const { n, latest } = rows[0];
  const staleMs = TICKER_REFRESH_DAYS * 24 * 3600 * 1000;
  if (n > 0 && latest && Date.now() - new Date(latest).getTime() < staleMs) return;

  const refs = [...(await fetchTickers("CS")), ...(await fetchTickers("ADRC"))];
  if (refs.length === 0) return;
  await sql`UPDATE tickers SET active = false`;
  for (let i = 0; i < refs.length; i += 500) {
    const chunk = refs.slice(i, i + 500);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      values.push(`($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}, true, now())`);
      params.push(r.ticker, r.name.slice(0, 200), r.type);
    });
    await sql.query(
      `INSERT INTO tickers (ticker, name, type, active, updated_at) VALUES ${values.join(",")}
       ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type,
         active = true, updated_at = now()`,
      params,
    );
  }
}

export async function upsertBars(date: string, dayBars: GroupedBar[]): Promise<void> {
  const sql = getSql();
  for (let i = 0; i < dayBars.length; i += 500) {
    const chunk = dayBars.slice(i, i + 500);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((b, j) => {
      const base = j * 7;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      );
      params.push(b.T, date, b.o, b.h, b.l, b.c, Math.round(b.v));
    });
    await sql.query(
      `INSERT INTO bars (ticker, date, o, h, l, c, v) VALUES ${values.join(",")}
       ON CONFLICT (ticker, date) DO UPDATE SET
         o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v`,
      params,
    );
  }
}

/**
 * Confirmed splits from the research layer (research/splits.py, status 'auto'):
 * bars BEFORE the split date are multiplied by factor (volume divided) so a
 * 1:3 reverse split stops reading as a +200% month. Empty until the research
 * job has run (or before the migration) — never throws.
 */
async function splitFactors(tickers: string[]): Promise<Map<string, { date: string; factor: number }[]>> {
  const out = new Map<string, { date: string; factor: number }[]>();
  try {
    const rows = (await getSql()`
      SELECT ticker, date::text AS date, factor FROM research_splits
      WHERE status = 'auto' AND ticker = ANY(${tickers}) ORDER BY ticker, date
    `) as { ticker: string; date: string; factor: number }[];
    for (const r of rows) {
      const arr = out.get(r.ticker) ?? [];
      arr.push({ date: r.date, factor: r.factor });
      out.set(r.ticker, arr);
    }
  } catch {
    // table missing (migration pending) — serve bars as stored
  }
  return out;
}

/** Pure: apply split factors to one ticker's bars (ascending by date). Exported for tests. */
export function adjustForSplits(bars: Bar[], splits: { date: string; factor: number }[]): Bar[] {
  if (splits.length === 0) return bars;
  return bars.map((b) => {
    let f = 1;
    for (const s of splits) if (b.date < s.date) f *= s.factor;
    return f === 1 ? b : { date: b.date, o: b.o * f, h: b.h * f, l: b.l * f, c: b.c * f, v: b.v / f };
  });
}

export async function loadBars(tickers: string[]): Promise<Map<string, Bar[]>> {
  const sql = getSql();
  const map = new Map<string, Bar[]>();
  if (tickers.length === 0) return map;
  const factors = await splitFactors(tickers);
  for (let i = 0; i < tickers.length; i += 200) {
    const chunk = tickers.slice(i, i + 200);
    const rows = (await sql`
      SELECT ticker, date::text AS date, o, h, l, c, v::double precision AS v
      FROM bars
      WHERE ticker = ANY(${chunk})
      ORDER BY ticker, date
    `) as (Bar & { ticker: string })[];
    for (const row of rows) {
      let arr = map.get(row.ticker);
      if (!arr) {
        arr = [];
        map.set(row.ticker, arr);
      }
      arr.push({ date: row.date, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v });
    }
  }
  for (const [ticker, splits] of factors) {
    const arr = map.get(ticker);
    if (arr) map.set(ticker, adjustForSplits(arr, splits));
  }
  return map;
}

export async function upsertAnalyses(date: string, analyses: Analysis[]): Promise<void> {
  const sql = getSql();
  // A rescan can drop tickers from the day's deck; don't leave their old reads behind.
  await sql`DELETE FROM analyses WHERE date = ${date} AND ticker <> ALL(${analyses.map((a) => a.ticker)})`;
  for (const a of analyses) {
    await sql`
      INSERT INTO analyses (date, ticker, analysis) VALUES (${date}, ${a.ticker}, ${JSON.stringify(a)}::jsonb)
      ON CONFLICT (date, ticker) DO UPDATE SET analysis = EXCLUDED.analysis, created_at = now()
    `;
  }
}

export async function latestScan(): Promise<ScanPayload | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT payload FROM scan_results ORDER BY date DESC LIMIT 1
  `) as { payload: ScanPayload }[];
  return rows[0]?.payload ?? null;
}

/**
 * Strip bars from every card except the indices in `keep` (wrapped into range),
 * so a page embeds only the charts it will show first. See `DeckCard`.
 */
export function slimDeck(candidates: Candidate[], keep: Iterable<number>): DeckCard[] {
  const n = candidates.length;
  const keepSet = new Set([...keep].map((i) => ((i % n) + n) % n));
  return candidates.map((c, i) => {
    if (keepSet.has(i)) return c;
    const { bars: _bars, ...rest } = c;
    void _bars;
    return rest;
  });
}

/** The bars one deck card was scanned with (the chart must match the scan, not a later day). Latest scan when `date` is omitted. */
export async function candidateBars(ticker: string, date: string | null): Promise<Bar[] | null> {
  const sql = getSql();
  const rows = (date
    ? await sql`
        SELECT c->'bars' AS bars FROM scan_results s, jsonb_array_elements(s.payload->'candidates') c
        WHERE s.date = ${date} AND c->>'ticker' = ${ticker}`
    : await sql`
        SELECT c->'bars' AS bars FROM scan_results s, jsonb_array_elements(s.payload->'candidates') c
        WHERE s.date = (SELECT max(date) FROM scan_results) AND c->>'ticker' = ${ticker}`) as { bars: Bar[] }[];
  return rows[0]?.bars ?? null;
}
