// Seed a year of daily bars for the market-health index ETFs (QQQ/SPY/IWM).
// The nightly scan keeps them current afterwards. One API call per index.
// Usage: npm run seed:indices
import { CONFIG } from "../lib/config";
import { addDays, etToday } from "../lib/dates";
import { fetchDailyRange, sleep } from "../lib/massive";
import { upsertBars } from "../lib/scan";

async function main() {
  const to = addDays(etToday(), -1);
  const from = addDays(to, -CONFIG.PRUNE_DAYS);
  for (const t of CONFIG.MARKET.INDICES) {
    const bars = await fetchDailyRange(t, from, to);
    for (const b of bars) await upsertBars(b.date, [{ T: t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }]);
    console.log(`${t}: ${bars.length} bars (${bars[0]?.date} → ${bars.at(-1)?.date})`);
    await sleep(12_500);
  }
  console.log("seed complete");
}
main().catch((err) => { console.error(err); process.exit(1); });
