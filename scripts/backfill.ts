// One-time historical backfill via grouped-daily (1 call per trading day).
// Free tier is 5 calls/min, so ~365 calendar days ≈ 250 calls ≈ 55 minutes.
// Resume-safe: skips dates already present in the DB.
// Secrets (MASSIVE_API_KEY, COIL_DATABASE_URL) are injected per-process from
// Vercel by `npm run backfill` (vercel env run) — nothing is read from .env files.
// Usage: npm run backfill            (365 calendar days)
//        npm run backfill -- 180     (custom depth)
import { addDays, etToday, isWeekend } from "../lib/dates";
import { getSql } from "../lib/db";
import { fetchGroupedDaily, fetchTickers, sleep } from "../lib/massive";
import { upsertBars } from "../lib/scan";

const THROTTLE_MS = 12_500;

async function ensureTickers(): Promise<Set<string>> {
  const sql = getSql();
  const rows = (await sql`SELECT ticker FROM tickers WHERE active`) as { ticker: string }[];
  if (rows.length > 0) return new Set(rows.map((r) => r.ticker));

  console.log("tickers table empty — fetching reference data (CS + ADRC)...");
  const refs = [...(await fetchTickers("CS")), ...(await fetchTickers("ADRC"))];
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
       ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, active = true, updated_at = now()`,
      params,
    );
  }
  console.log(`stored ${refs.length} tickers`);
  return new Set(refs.map((r) => r.ticker));
}

async function main() {
  const calendarDays = Number(process.argv[2] ?? 365);
  const sql = getSql();
  const known = await ensureTickers();

  const existing = (await sql`SELECT DISTINCT date::text AS date FROM bars`) as { date: string }[];
  const have = new Set(existing.map((r) => r.date));

  const dates: string[] = [];
  let d = addDays(etToday(), -1);
  for (let i = 0; i < calendarDays; i++) {
    if (!isWeekend(d) && !have.has(d)) dates.push(d);
    d = addDays(d, -1);
  }
  console.log(`${dates.length} trading dates to fetch (~${Math.ceil((dates.length * THROTTLE_MS) / 60000)} min)`);

  let done = 0;
  for (const date of dates) {
    const grouped = await fetchGroupedDaily(date);
    const filtered = grouped.filter((g) => known.has(g.T));
    if (filtered.length > 0) await upsertBars(date, filtered);
    done++;
    console.log(`${date}: ${filtered.length} bars (${done}/${dates.length})`);
    if (done < dates.length) await sleep(THROTTLE_MS);
  }
  console.log("backfill complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
