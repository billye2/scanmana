// Recompute the per-candidate analyses for the latest stored scan without
// rescanning (e.g. after changing lib/analysis.ts). Usage: npm run analyze
import { analyzeCandidate } from "../lib/analysis";
import { getSql } from "../lib/db";
import { latestScan, upsertAnalyses } from "../lib/scan";

async function main() {
  const payload = await latestScan();
  if (!payload) throw new Error("no scan stored yet");
  const analyses = payload.candidates.map((c) => analyzeCandidate(c, payload.market));
  payload.candidates.forEach((c, i) => (c.verdict = analyses[i].overall));
  await getSql()`UPDATE scan_results SET payload = ${JSON.stringify(payload)}::jsonb WHERE date = ${payload.date}`;
  await upsertAnalyses(payload.date, analyses);
  const counts = analyses.reduce((m, a) => ({ ...m, [a.overall]: (m[a.overall] ?? 0) + 1 }), {} as Record<string, number>);
  console.log(`${payload.date}: ${analyses.length} analyses stored`, counts);
}
main().catch((err) => { console.error(err); process.exit(1); });
