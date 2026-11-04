import Link from "next/link";
import { RHistogram } from "@/components/ResearchCharts";
import { ResearchRefresh, SplitActions } from "@/components/ResearchControls";
import { Card, H, NUM, SUMMARY, TD, TH, money, n, pc, rr } from "@/components/ResearchPrimitives";
import TopNav from "@/components/TopNav";
import { pct } from "@/lib/format";
import { closedTrades, getBreadth, getEpStudy, getReplay, getResearchSummary, getSplits, getStory } from "@/lib/research";
import Band from "@/components/Band";
import { LENS_LABEL, MIN_AFTER_N, formatLens, researchHealth, researchRead, type Lens } from "@/lib/research-story";
import { latestScanSlim } from "@/lib/scan";
import type { Interval } from "@/lib/stats";
import { tapeMultiplier } from "@/lib/tape";

export const metadata = { title: "Research — Scanmana" };
export const dynamic = "force-dynamic";

const lensKind = (lens: Lens): "rate" | "r" | "pts" => (lens === "deck_hit" ? "rate" : lens === "paper_avg_r" ? "r" : "pts");

/** One scorecard tile: the all-history number large, the since-last-change number under it; each with its 95% range when it has one (1.7.6). */
function Tile({ label, all, since, n, sinceN, sinceDate, firstRead, band }: {
  label: string; all: string; since: string; n: string; sinceN: string; sinceDate: string | null; firstRead: string | null;
  band?: { kind: "rate" | "r" | "pts"; all: { value: number | null; interval: Interval | null }; since: { value: number | null; interval: Interval | null } };
}) {
  const empty = sinceN === "0";
  return (
    <Card className="min-w-0">
      <div className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">{label}</div>
      <div className="mt-1 font-mono text-2xl tabular-nums text-neutral-100">
        {band ? <Band text={all} value={band.all.value} interval={band.all.interval} kind={band.kind} /> : all}
      </div>
      <div className="text-[10px] text-neutral-600">all · n={n}</div>
      {sinceDate && (
        <div className="mt-2 border-t border-neutral-800 pt-1.5 text-[11px]">
          <span className="text-neutral-500">since {sinceDate.slice(5)} · </span>
          <span className={`font-mono tabular-nums ${empty ? "text-neutral-600" : "text-amber-300"}`}>
            {band && !empty ? <Band text={since} value={band.since.value} interval={band.since.interval} kind={band.kind} tone="" /> : since}
          </span>
          <span className="text-neutral-600"> n={sinceN}</span>
          {empty && firstRead && <div className="text-[10px] text-neutral-600">first read around {firstRead}</div>}
        </div>
      )}
    </Card>
  );
}

/**
 * /research — is the scanner working, and did the last rule change help? Since
 * 1.7.5 the page keeps to that question: this week's read, the scorecard, the
 * rule-change table, and Maintenance (splits, replay, job log). The studies
 * that used to sit between them live on /studies.
 */
export default async function ResearchPage() {
  const scan = await latestScanSlim().catch(() => null);
  const [summary, story, splits, breadth, replay, autoTrades, ep] = await Promise.all([
    getResearchSummary(),
    getStory(),
    getSplits(),
    getBreadth(120), // the read needs breadth now against ten sessions ago
    getReplay(),
    closedTrades("auto"),
    getEpStudy(), // the read's watch line names the neglected-and-10× row
  ]);
  const ran = summary.runs.some((r) => r.ok);
  const health = researchHealth(summary.runs, scan?.date ?? null);
  const reviewSplits = splits.filter((s) => s.status === "review").length;
  const okJobs = summary.runs.filter((r) => r.ok).length;
  const autoRs = autoTrades.map((t) => t.r);
  const { all, since } = story;
  // This week's read (1.5.6): the page's verdict in words, by rules, from the numbers below. No new query.
  const bRows = breadth.rows;
  const bToday = bRows.length ? bRows[bRows.length - 1].pctAbove20 : null;
  const bPrev = bRows.length > 10 ? bRows[bRows.length - 11].pctAbove20 : null;
  const bullish = scan?.market ? scan.market.verdict === "bullish" : null;
  const read = researchRead({
    all,
    since,
    sinceDate: story.sinceDate,
    changes: story.changes,
    breadth: { today: bToday, prev: bPrev },
    bullish,
    sizeLabel: tapeMultiplier(bullish, bToday).label,
    ep: ep.byBoth.find((g) => g.key === "both") ?? null,
    jobs: { ok: okJobs, total: summary.runs.length, at: summary.runs.map((r) => r.finishedAt).filter((t): t is string => !!t).sort().at(-1) ?? null },
  });

  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-5xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/research" subtitle={summary.lastDate ? `Research · ${summary.scans} scans · ${summary.firstDate} → ${summary.lastDate}` : "Research"} />

      <p className="text-[13px] leading-relaxed text-neutral-300">
        Is the scanner working, and did the last rule change help? A Python job labels every past deck name with what happened
        next; this page reads those tables and changes nothing. The deeper reads — the plan on history, breakout rates, the EP study,
        the sweep, breadth, themes — are on <Link href="/studies" className="text-neutral-100 underline underline-offset-4">Studies</Link>;
        the charts that worked on <Link href="/gallery" className="text-neutral-100 underline underline-offset-4">Best setups</Link>. Terms in{" "}
        <Link href="/help#research" className="text-neutral-100 underline underline-offset-4">Help</Link>.
      </p>
      {!ran && (
        <Card className="mt-4 text-[12px] leading-relaxed text-neutral-400">
          No research run yet. The history backfill (<span className="font-mono">npm run backfill:scans</span>) fills{" "}
          <span className="font-mono">scan_history</span>; then the jobs run after the next scan or from Maintenance below.
        </Card>
      )}

      {ran && (
        <Card className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">This week&apos;s read</p>
          <p className="mt-1 text-[13px] leading-relaxed text-neutral-200">
            <span className="font-semibold">{read.headline}</span> {read.body}
          </p>
          {read.watch && <p className="mt-1 text-[11px] text-neutral-500">{read.watch}</p>}
        </Card>
      )}

      {/* ---------- 1. Scorecard ---------- */}
      <H id="scorecard" sub={story.sinceDate ? `All labelled history, and separately everything since the last rule change took effect (${story.sinceDate}).` : "All labelled history."}>
        Scorecard
      </H>
      {health && (
        <p className="mb-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12px] text-red-300">{health}</p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Deck broke out" all={pc(all.deckHit)} since={pc(since.deckHit)} n={n(all.deckN)} sinceN={n(since.deckN)} sinceDate={story.sinceDate} firstRead={story.firstRead}
          band={{ kind: "rate", all: { value: all.deckHit, interval: all.deckHitCI }, since: { value: since.deckHit, interval: since.deckHitCI } }} />
        <Tile label="Wait − Pass" all={all.gap === null ? "—" : formatLens("verdict_gap", all.gap).replace(/ points?$/, " pts")} since={since.gap === null ? "—" : formatLens("verdict_gap", since.gap).replace(/ points?$/, " pts")} n={n(Math.min(all.waitN, all.passN))} sinceN={n(Math.min(since.waitN, since.passN))} sinceDate={story.sinceDate} firstRead={story.firstRead}
          band={{ kind: "pts", all: { value: all.gap, interval: all.gapCI }, since: { value: since.gap, interval: since.gapCI } }} />
        <Tile label="Avg R on Wait" all={rr(all.waitAvgR)} since={rr(since.waitAvgR)} n={n(all.waitRN)} sinceN={n(since.waitRN)} sinceDate={story.sinceDate} firstRead={story.firstRead}
          band={{ kind: "r", all: { value: all.waitAvgR, interval: all.waitAvgRCI }, since: { value: since.waitAvgR, interval: since.waitAvgRCI } }} />
        <Tile label="Bullish nights" all={pc(all.bullishShare)} since={pc(since.bullishShare)} n={n(all.nights)} sinceN={n(since.nights)} sinceDate={story.sinceDate} firstRead={story.firstRead} />
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-neutral-200">{story.sentence}</p>

      {/* ---------- 2. Rule changes ---------- */}
      <H id="changes" sub={`One row per shipped change, scored on the number it was meant to move: all labelled history before it against everything from it on. A row stays grey until the after side has ${MIN_AFTER_N} rows, and turns green or red only once the two 95% ranges (the bars under the numbers) are apart; amber means they still overlap.`}>
        Rule changes
      </H>
      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead><tr><th className={TH}>Change</th><th className={TH}>Effective</th><th className={TH}>Lens</th><th className={`${TH} text-right`}>Before</th><th className={`${TH} text-right`}>After</th><th className={`${TH} text-right`}>n after</th></tr></thead>
          <tbody>
            {story.changes.map((c) => (
              <tr key={`${c.version}-${c.label}`} className={`border-t border-neutral-800 ${c.ready ? "" : "text-neutral-500"}`}>
                <td className={`${TD} whitespace-normal ${c.ready ? "text-neutral-100" : ""}`}>{c.label} <span className="font-mono text-[10px] text-neutral-600">{c.version}</span></td>
                <td className={`${TD} font-mono`}>{c.effective}</td>
                <td className={`${TD} whitespace-normal text-[11px]`}>{LENS_LABEL[c.lens]}</td>
                <td className={NUM}>
                  <Band text={formatLens(c.lens, c.before.value)} value={c.before.value} interval={c.before.interval ?? null} kind={lensKind(c.lens)} tone="" />{" "}
                  <span className="text-neutral-600">n={n(c.before.n)}</span>
                </td>
                <td className={`${NUM} ${c.ready ? (c.separated !== true ? "text-amber-300" : c.after.value !== null && c.before.value !== null && c.after.value >= c.before.value ? "text-emerald-300" : "text-red-300") : "text-neutral-600"}`}>
                  {c.after.n === 0 ? (
                    <span className="font-sans text-[11px]">first read around {c.firstRead}</span>
                  ) : (
                    <Band text={formatLens(c.lens, c.after.value)} value={c.after.value} interval={c.after.interval ?? null} kind={lensKind(c.lens)} tone="" />
                  )}
                </td>
                <td className={`${NUM} ${c.ready ? "" : "text-neutral-600"}`}>{n(c.after.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="mt-6 text-[13px] leading-relaxed text-neutral-400">
        Where the numbers behind a change live: <Link href="/studies" className="text-neutral-100 underline underline-offset-4">Studies</Link> — the plan on every boxed Wait card,
        the breakout rates, the EP study, the threshold sweep, breadth and the themes.
      </p>

      {/* ---------- 3. Maintenance ---------- */}
      <details className="mt-8">
        <summary className={SUMMARY}>
          <span className="text-sm font-semibold tracking-wide text-neutral-400 uppercase">Maintenance</span>
          <span className="ml-2 text-[11px] text-neutral-500">
            {reviewSplits} split{reviewSplits === 1 ? "" : "s"} to review · {autoRs.length} replayed auto trade{autoRs.length === 1 ? "" : "s"} · {okJobs} of {summary.runs.length || 7} jobs ok
          </span>
        </summary>
        <div className="mt-3">
          <ResearchRefresh />
        </div>

        <H id="splits" sub="Clean-ratio overnight gaps with the volume signature of a split. Status auto rescales the earlier bars everywhere the app reads them; review rows wait for you. Dismissed rows stay dismissed.">
          Split audit
        </H>
        {splits.length === 0 ? (
          <Card className="text-xs text-neutral-500">No split-like gaps found.</Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full">
              <thead><tr><th className={TH}>Ticker</th><th className={TH}>Date</th><th className={`${TH} text-right`}>Ratio</th><th className={`${TH} text-right`}>Gap</th><th className={`${TH} text-right`}>Vol ratio</th><th className={`${TH} text-right`}>Confidence</th><th className={TH}>Status</th><th className={TH}></th></tr></thead>
              <tbody>
                {splits.map((s) => (
                  <tr key={`${s.ticker}-${s.date}`} className="border-t border-neutral-800">
                    <td className={`${TD} font-semibold text-neutral-100`}><Link href={`/s/${s.ticker}`} className="underline decoration-neutral-700 underline-offset-4">{s.ticker}</Link></td>
                    <td className={`${TD} font-mono`}>{s.date}</td>
                    <td className={NUM}>{s.factor >= 1 ? `1:${Math.round(s.factor)}` : `${Math.round(1 / s.factor)}:1`}</td>
                    <td className={`${NUM} text-red-300`}>{pct(s.gapPct)}</td>
                    <td className={NUM}>{s.volRatio === null ? "—" : `${s.volRatio.toFixed(2)}×`}</td>
                    <td className={NUM}>{s.confidence.toFixed(2)}</td>
                    <td className={TD}>
                      <span className={s.status === "auto" ? "text-emerald-300" : s.status === "review" ? "text-amber-300" : "text-neutral-500"}>
                        {s.status === "auto" ? "auto-adjust" : s.status}
                      </span>
                    </td>
                    <td className={TD}><SplitActions row={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <H id="replay" sub="Every closed paper trade replayed under other exit rules on the stored bars. Highlighted: the current rule and the best. Drawdown is the worst dip of the cumulative P&L, as a share of the $10,000 start. With few trades the best rule is noise.">
          Paper-ledger replay
        </H>
        {replay.length === 0 ? (
          <Card className="text-xs text-neutral-500">No closed paper trades yet — the replay starts once the auto book has exits.</Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
            <Card className="overflow-x-auto p-0">
              <table className="w-full">
                <thead><tr><th className={TH}>Track</th><th className={TH}>Exit rule</th><th className={`${TH} text-right`}>Avg R</th><th className={`${TH} text-right`}>Win rate</th><th className={`${TH} text-right`}>Max drawdown</th><th className={`${TH} text-right`}>Avg hold</th><th className={`${TH} text-right`}>Total P&amp;L</th><th className={`${TH} text-right`}>Trades</th></tr></thead>
                <tbody>
                  {(["auto", "manual"] as const).map((track) => {
                    const rows = replay.filter((r) => r.track === track);
                    const best = rows.filter((r) => r.rule !== "actual" && r.avgR !== null).reduce<typeof rows[number] | null>((a, b) => (a === null || b.avgR! > a.avgR! ? b : a), null);
                    return rows.map((r) => (
                      <tr key={`${r.track}-${r.rule}`} className={`border-t border-neutral-800 ${r.isCurrent ? "bg-amber-900/15" : best && r.rule === best.rule ? "bg-emerald-900/15" : ""}`}>
                        <td className={TD}>{r.track}</td>
                        <td className={`${TD} text-neutral-100`}>{r.label}{r.isCurrent && <span className="ml-1 text-[10px] text-amber-300">current</span>}{best && r.rule === best.rule && <span className="ml-1 text-[10px] text-emerald-300">best</span>}</td>
                        <td className={NUM}>{rr(r.avgR)}</td>
                        <td className={NUM}>{pc(r.winRate)}</td>
                        <td className={NUM}>{r.maxDd === null ? "—" : `${(r.maxDd * 100).toFixed(0)}%`}</td>
                        <td className={NUM}>{r.avgHold === null ? "—" : `${r.avgHold.toFixed(0)}d`}</td>
                        <td className={`${NUM} ${(r.totalPnl ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(r.totalPnl)}</td>
                        <td className={NUM}>{r.trades}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </Card>
            <Card>
              <div className="mb-1 text-[11px] font-semibold text-neutral-400">R per closed auto trade · {autoRs.length}</div>
              <RHistogram rs={autoRs} />
            </Card>
          </div>
        )}

        <H id="runs" sub="One row per job. A job is skipped when it is already current for the latest scan; Refresh forces all seven.">
          Job log
        </H>
        <Card className="overflow-x-auto p-0">
          <table className="w-full">
            <thead><tr><th className={TH}>Job</th><th className={TH}>Scan date</th><th className={TH}>Status</th><th className={TH}>Finished</th><th className={TH}>Note</th></tr></thead>
            <tbody>
              {summary.runs.length === 0 && <tr><td className={TD} colSpan={5}>No runs yet.</td></tr>}
              {summary.runs.map((r) => (
                <tr key={r.job} className="border-t border-neutral-800">
                  <td className={`${TD} font-mono`}>{r.job}</td>
                  <td className={`${TD} font-mono`}>{r.scanDate ?? "—"}</td>
                  <td className={TD}>{r.ok === null ? <span className="text-amber-300">running</span> : r.ok ? <span className="text-emerald-300">ok</span> : <span className="text-red-300">failed</span>}</td>
                  <td className={`${TD} font-mono`}>{r.finishedAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td className={`${TD} whitespace-normal`}>{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-6 text-[11px] text-neutral-600">Levels on this page are scan-night values; prices in the split table are as stored.</p>
      </details>
    </main>
  );
}
