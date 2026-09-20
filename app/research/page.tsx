import Link from "next/link";
import { BreadthLine, BucketBars, RHistogram, RateBars, SweepPanel } from "@/components/ResearchCharts";
import { ClusterAlias, ResearchRefresh, SplitActions } from "@/components/ResearchControls";
import TopNav from "@/components/TopNav";
import { pct } from "@/lib/format";
import {
  SWEEP_CURRENT,
  closedTrades,
  getBreadth,
  getClusters,
  getReplay,
  getResearchSummary,
  getSplits,
  getStory,
  getSweep,
} from "@/lib/research";
import { LENS_LABEL, MIN_AFTER_N, formatLens, researchHealth, sweepHeadline } from "@/lib/research-story";
import { latestScan } from "@/lib/scan";

export const metadata = { title: "Research — Scanmana" };
export const dynamic = "force-dynamic";

function H({ id, children, sub }: { id: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mt-8 mb-3">
      <h2 id={id} className="text-sm font-semibold tracking-wide text-emerald-400 uppercase">{children}</h2>
      {sub && <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">{sub}</p>}
    </div>
  );
}
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl bg-neutral-900 p-3 ${className}`}>{children}</div>
);
const TH = "px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-neutral-500 uppercase whitespace-nowrap";
const TD = "px-2 py-1.5 text-xs text-neutral-300 whitespace-nowrap";
const NUM = `${TD} text-right font-mono tabular-nums`;
const SUMMARY = "cursor-pointer select-none text-[12px] text-neutral-400 marker:text-neutral-600 hover:text-neutral-200";
const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const rr = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
const money = (x: number | null) => (x === null ? "—" : `${x < 0 ? "−" : "+"}$${Math.abs(x).toFixed(0)}`);
const SWEEP_LABEL: Record<string, { title: string; sub: string; fmt: (v: number) => string }> = {
  MIN_DOLLAR_VOLUME: { title: "MIN_DOLLAR_VOLUME", sub: `20-day avg $ volume floor · now $${SWEEP_CURRENT.MIN_DOLLAR_VOLUME / 1e6}M`, fmt: (v) => `$${Math.round(v / 1e6)}M` },
  MIN_ADR_PCT: { title: "MIN_ADR_PCT", sub: `Average daily range floor · now ${SWEEP_CURRENT.MIN_ADR_PCT}%`, fmt: (v) => `${v}%` },
  MAX_DIST_FROM_HIGH: { title: "MAX_DIST_FROM_HIGH", sub: `Within this of the 6-month high · now ${SWEEP_CURRENT.MAX_DIST_FROM_HIGH * 100}%`, fmt: (v) => `${Math.round(v * 100)}%` },
  MIN_PRICE: { title: "MIN_PRICE", sub: `Price floor · now $${SWEEP_CURRENT.MIN_PRICE} (scan-night close only)`, fmt: (v) => `$${v}` },
};

/** One scorecard tile: the all-history number large, the since-last-change number under it. */
function Tile({ label, all, since, n, sinceN, sinceDate, firstRead }: {
  label: string; all: string; since: string; n: string; sinceN: string; sinceDate: string | null; firstRead: string | null;
}) {
  const empty = sinceN === "0";
  return (
    <Card className="min-w-0">
      <div className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">{label}</div>
      <div className="mt-1 font-mono text-2xl tabular-nums text-neutral-100">{all}</div>
      <div className="text-[10px] text-neutral-600">all · n={n}</div>
      {sinceDate && (
        <div className="mt-2 border-t border-neutral-800 pt-1.5 text-[11px]">
          <span className="text-neutral-500">since {sinceDate.slice(5)} · </span>
          <span className={`font-mono tabular-nums ${empty ? "text-neutral-600" : "text-amber-300"}`}>{since}</span>
          <span className="text-neutral-600"> n={sinceN}</span>
          {empty && firstRead && <div className="text-[10px] text-neutral-600">first read around {firstRead}</div>}
        </div>
      )}
    </Card>
  );
}

export default async function ResearchPage() {
  const scan = await latestScan().catch(() => null);
  const deckTickers = scan?.candidates.map((c) => c.ticker) ?? [];
  const [summary, story, sweep, clusters, splits, breadth, replay, autoTrades] = await Promise.all([
    getResearchSummary(),
    getStory(),
    getSweep(),
    getClusters(deckTickers),
    getSplits(),
    getBreadth(120),
    getReplay(),
    closedTrades("auto"),
  ]);
  const ran = summary.runs.some((r) => r.ok);
  const health = researchHealth(summary.runs, scan?.date ?? null);
  const sweepParams = Object.keys(SWEEP_LABEL).filter((p) => sweep.some((s) => s.param === p));
  const headline = sweepHeadline(sweep);
  const themes = clusters.filter((c) => c.inDeck.length >= 2).sort((a, b) => b.inDeck.length - a.inDeck.length || b.ret63d - a.ret63d).slice(0, 8);
  const reviewSplits = splits.filter((s) => s.status === "review").length;
  const okJobs = summary.runs.filter((r) => r.ok).length;
  const autoRs = autoTrades.map((t) => t.r);
  const { all, since } = story;
  const n = (x: number) => x.toLocaleString();

  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-5xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/research" subtitle={summary.lastDate ? `Research · ${summary.scans} scans · ${summary.firstDate} → ${summary.lastDate}` : "Research"} />

      <p className="text-[13px] leading-relaxed text-neutral-300">
        Is the scanner working, and did the last rule change help? A Python job labels every past deck name with what happened
        next; this page reads those tables and changes nothing. Terms in{" "}
        <Link href="/help#research" className="text-neutral-100 underline underline-offset-4">Help</Link>.
      </p>
      {!ran && (
        <Card className="mt-4 text-[12px] leading-relaxed text-neutral-400">
          No research run yet. The history backfill (<span className="font-mono">npm run backfill:scans</span>) fills{" "}
          <span className="font-mono">scan_history</span>; then the jobs run after the next scan or from Maintenance below.
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
        <Tile label="Deck broke out" all={pc(all.deckHit)} since={pc(since.deckHit)} n={n(all.deckN)} sinceN={n(since.deckN)} sinceDate={story.sinceDate} firstRead={story.firstRead} />
        <Tile label="Wait − Pass" all={all.gap === null ? "—" : formatLens("verdict_gap", all.gap).replace(/ points?$/, " pts")} since={since.gap === null ? "—" : formatLens("verdict_gap", since.gap).replace(/ points?$/, " pts")} n={n(Math.min(all.waitN, all.passN))} sinceN={n(Math.min(since.waitN, since.passN))} sinceDate={story.sinceDate} firstRead={story.firstRead} />
        <Tile label="Avg R on Wait" all={rr(all.waitAvgR)} since={rr(since.waitAvgR)} n={n(all.waitRN)} sinceN={n(since.waitRN)} sinceDate={story.sinceDate} firstRead={story.firstRead} />
        <Tile label="Bullish nights" all={pc(all.bullishShare)} since={pc(since.bullishShare)} n={n(all.nights)} sinceN={n(since.nights)} sinceDate={story.sinceDate} firstRead={story.firstRead} />
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-neutral-200">{story.sentence}</p>

      {/* ---------- 2. Rule changes ---------- */}
      <H id="changes" sub={`One row per shipped change, scored on the number it was meant to move: all labelled history before it against everything from it on. A row stays grey until the after side has ${MIN_AFTER_N} rows.`}>
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
                <td className={NUM}>{formatLens(c.lens, c.before.value)} <span className="text-neutral-600">n={n(c.before.n)}</span></td>
                <td className={`${NUM} ${c.ready ? (c.after.value !== null && c.before.value !== null && c.after.value >= c.before.value ? "text-emerald-300" : "text-red-300") : "text-neutral-600"}`}>
                  {c.after.n === 0 ? <span className="font-sans text-[11px]">first read around {c.firstRead}</span> : formatLens(c.lens, c.after.value)}
                </td>
                <td className={`${NUM} ${c.ready ? "" : "text-neutral-600"}`}>{n(c.after.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ---------- 3. Outcomes ---------- */}
      <H id="outcomes" sub={`Deck names only (the capped nightly deck), ${n(summary.labelled)} of ${n(summary.deckRows)} labelled so far. "Broke out" = a close within ten sessions of the scan above the box top, else above the pivot while it is still overhead, else above the 20-session high.`}>
        Breakout rate within 10 sessions
      </H>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <RateBars rows={[...summary.byVerdict, ...summary.byBadge].map((g) => ({ label: g.label, rate: g.hitRate, n: g.n }))} />
        </Card>
        <Card>
          <div className="mb-1 text-[11px] font-semibold text-neutral-400">When a framework said no</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className={TH}>Framework</th><th className={`${TH} text-right`}>Hit when it objected</th><th className={`${TH} text-right`}>Hit otherwise</th></tr></thead>
              <tbody>
                {summary.byFramework.map((f) => (
                  <tr key={f.framework} className="border-t border-neutral-800">
                    <td className={`${TD} whitespace-normal`}>{f.label}{f.framework === "livermore" && <span className="ml-1 text-[10px] text-neutral-500">advisory since 1.3.0</span>}</td>
                    <td className={`${NUM} ${f.hitObjected !== null && f.hitOther !== null && f.hitObjected < f.hitOther ? "text-red-300" : ""}`}>{pc(f.hitObjected)} <span className="text-neutral-600">n={n(f.nObjected)}</span></td>
                    <td className={NUM}>{pc(f.hitOther)} <span className="text-neutral-600">n={n(f.nOther)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">Red: cards that framework vetoed did worse than the rest, so the veto earns its place. Livermore&apos;s veto is scored but no longer applied.</p>
        </Card>
      </div>

      {/* ---------- 4. Sweep ---------- */}
      <H id="sweep" sub="One screen floor moved at a time, the other three held at today's values, the deck cap re-applied. A report for retuning lib/config.ts, nothing on the deck reads it.">
        Threshold sweep
      </H>
      {sweepParams.length === 0 ? (
        <Card className="text-xs text-neutral-500">No sweep yet.</Card>
      ) : (
        <Card>
          <p className="text-[13px] leading-relaxed text-neutral-200">
            {headline ? (
              <>
                Biggest gap: <span className="font-mono text-amber-300">{headline.param}</span>. Now {SWEEP_LABEL[headline.param].fmt(headline.current.value)} at {pc(headline.current.hitRate)};{" "}
                {SWEEP_LABEL[headline.param].fmt(headline.best.value)} would have been {pc(headline.best.hitRate)} <span className="text-neutral-500">(n={n(headline.best.n)})</span>. One change at a time; score it above before the next.
              </>
            ) : (
              <>Every knob is at, or within a point of, its best value in the sweep. Nothing to retune.</>
            )}
          </p>
          <details className="mt-2">
            <summary className={SUMMARY}>The four curves</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {sweepParams.map((p) => (
                <div key={p} className="min-w-0 rounded-lg bg-neutral-950/60 p-2">
                  <div className="text-[12px] font-semibold text-neutral-200">{SWEEP_LABEL[p].title}</div>
                  <div className="mb-2 text-[11px] text-neutral-500">{SWEEP_LABEL[p].sub}</div>
                  <SweepPanel points={sweep.filter((s) => s.param === p)} fmt={SWEEP_LABEL[p].fmt} />
                </div>
              ))}
            </div>
          </details>
        </Card>
      )}

      {/* ---------- 5. Breadth ---------- */}
      <H id="breadth" sub="Share of the universe (price ≥ $5, ≥ $5M/day) above its 20-day average. Green bands: sessions the index verdict called Bullish. Right: the deck's 10-session hit rate by the breadth on scan night.">
        Market breadth
      </H>
      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <Card><BreadthLine rows={breadth.rows} /></Card>
        <Card>
          <div className="mb-1 text-[11px] font-semibold text-neutral-400">Hit rate by breadth</div>
          <BucketBars buckets={breadth.buckets} />
        </Card>
      </div>

      {/* ---------- 6. Themes ---------- */}
      <H id="themes" sub="Groups that moved together over the last 63 sessions, from price alone, with two or more names in tonight's deck. Amber tickers are on the deck. Membership is saved nightly so a per-theme hit rate can be measured once there is history.">
        Themes on tonight&apos;s deck
      </H>
      {themes.length === 0 ? (
        <Card className="text-xs text-neutral-500">{clusters.length === 0 ? "No clusters yet." : "No theme has two or more names on tonight's deck."}</Card>
      ) : (
        <Card className="divide-y divide-neutral-800 p-0">
          {themes.map((c) => (
            <div key={c.clusterId} className="flex flex-col gap-1.5 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0 truncate text-[12px] font-semibold text-neutral-100">{c.alias ?? c.leaders.join(" · ")}</div>
                <div className="shrink-0 text-[11px] text-neutral-500">
                  <b className="text-amber-300">{c.inDeck.length}</b> of {c.memberCount} on deck · <span className={`font-mono ${c.ret63d >= 0 ? "text-emerald-300" : "text-red-300"}`}>{pct(c.ret63d)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {c.inDeck.map((m) => (
                  <Link key={m} href={`/s/${m}`} className="rounded bg-amber-900/50 px-1.5 py-px font-mono text-[10px] text-amber-300">{m}</Link>
                ))}
                {c.members.filter((m) => !c.inDeck.includes(m)).slice(0, 8).map((m) => (
                  <Link key={m} href={`/s/${m}`} className="rounded bg-neutral-800 px-1.5 py-px font-mono text-[10px] text-neutral-500">{m}</Link>
                ))}
                {c.memberCount > c.inDeck.length + 8 && <span className="px-1 text-[10px] text-neutral-600">+{c.memberCount - c.inDeck.length - 8}</span>}
                <ClusterAlias clusterKey={c.clusterKey} alias={c.alias} />
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* ---------- 7. Maintenance ---------- */}
      <details className="mt-8">
        <summary className={SUMMARY}>
          <span className="text-sm font-semibold tracking-wide text-neutral-400 uppercase">Maintenance</span>
          <span className="ml-2 text-[11px] text-neutral-500">
            {reviewSplits} split{reviewSplits === 1 ? "" : "s"} to review · {autoRs.length} replayed auto trade{autoRs.length === 1 ? "" : "s"} · {okJobs} of {summary.runs.length || 6} jobs ok
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

        <H id="runs" sub="One row per job. A job is skipped when it is already current for the latest scan; Refresh forces all six.">
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
