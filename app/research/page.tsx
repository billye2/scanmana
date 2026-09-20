import Link from "next/link";
import { BreadthLine, BucketBars, RHistogram, RateBars, SweepPanel } from "@/components/ResearchCharts";
import { ClusterAlias, ResearchRefresh, SplitActions } from "@/components/ResearchControls";
import TopNav from "@/components/TopNav";
import { pct } from "@/lib/format";
import {
  SWEEP_CURRENT,
  closedTradeRs,
  getBreadth,
  getClusters,
  getReplay,
  getResearchSummary,
  getSplits,
  getSweep,
} from "@/lib/research";
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
const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const rr = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
const money = (x: number | null) => (x === null ? "—" : `${x < 0 ? "−" : "+"}$${Math.abs(x).toFixed(0)}`);
const SWEEP_LABEL: Record<string, { title: string; sub: string; fmt: (v: number) => string }> = {
  MIN_DOLLAR_VOLUME: { title: "MIN_DOLLAR_VOLUME", sub: `20-day avg $ volume floor · now $${SWEEP_CURRENT.MIN_DOLLAR_VOLUME / 1e6}M`, fmt: (v) => `$${Math.round(v / 1e6)}M` },
  MIN_ADR_PCT: { title: "MIN_ADR_PCT", sub: `Average daily range floor · now ${SWEEP_CURRENT.MIN_ADR_PCT}%`, fmt: (v) => `${v}%` },
  MAX_DIST_FROM_HIGH: { title: "MAX_DIST_FROM_HIGH", sub: `Within this of the 6-month high · now ${SWEEP_CURRENT.MAX_DIST_FROM_HIGH * 100}%`, fmt: (v) => `${Math.round(v * 100)}%` },
  MIN_PRICE: { title: "MIN_PRICE", sub: `Price floor · now $${SWEEP_CURRENT.MIN_PRICE} (scan-night close only)`, fmt: (v) => `$${v}` },
};

export default async function ResearchPage() {
  const scan = await latestScan().catch(() => null);
  const deckTickers = scan?.candidates.map((c) => c.ticker) ?? [];
  const [summary, sweep, clusters, splits, breadth, replay, autoRs] = await Promise.all([
    getResearchSummary(),
    getSweep(),
    getClusters(deckTickers),
    getSplits(),
    getBreadth(120),
    getReplay(),
    closedTradeRs("auto"),
  ]);
  const ran = summary.runs.some((r) => r.ok);
  const sweepParams = Object.keys(SWEEP_LABEL).filter((p) => sweep.some((s) => s.param === p));

  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-5xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/research" subtitle={summary.lastDate ? `Research · ${summary.scans} scans · ${summary.firstDate} → ${summary.lastDate}` : "Research"} />

      <p className="text-[13px] leading-relaxed text-neutral-300">
        What the scanner&apos;s own history says. A Python job runs after each nightly scan and labels every past deck
        name with what happened next; this page reads those tables. It never changes the scan, the verdicts or the paper
        book. See <Link href="/help#research" className="text-neutral-100 underline underline-offset-4">Help</Link> for the terms.
      </p>
      <div className="mt-3">
        <ResearchRefresh />
      </div>
      {!ran && (
        <Card className="mt-4 text-[12px] leading-relaxed text-neutral-400">
          No research run yet. The history backfill (<span className="font-mono">npm run backfill:scans</span>) fills{" "}
          <span className="font-mono">scan_history</span>; then the jobs run after the next scan or with the button above.
        </Card>
      )}

      {/* ---------- 1. Outcomes ---------- */}
      <H id="outcomes" sub={`Deck names only (the capped nightly deck), ${summary.labelled} of ${summary.deckRows} labelled so far. "Broke out" = a close within ten sessions of the scan above the box top, else above the pivot while it is still overhead, else above the 20-session high.`}>
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
                    <td className={TD}>{f.label}</td>
                    <td className={`${NUM} ${f.hitObjected !== null && f.hitOther !== null && f.hitObjected < f.hitOther ? "text-red-300" : ""}`}>{pc(f.hitObjected)} <span className="text-neutral-600">n={f.nObjected}</span></td>
                    <td className={NUM}>{pc(f.hitOther)} <span className="text-neutral-600">n={f.nOther}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-neutral-500 sm:grid-cols-4">
            {summary.byVerdict.map((g) => (
              <div key={g.key}><div className="uppercase tracking-wide">{g.label} avg R</div><div className="font-mono text-sm text-neutral-200">{rr(g.avgR)}</div></div>
            ))}
            <div><div className="uppercase tracking-wide">Scans</div><div className="font-mono text-sm text-neutral-200">{summary.scans}</div></div>
            <div><div className="uppercase tracking-wide">Deck rows</div><div className="font-mono text-sm text-neutral-200">{summary.deckRows}</div></div>
          </div>
        </Card>
      </div>

      {/* ---------- 2. Sweep ---------- */}
      <H id="sweep" sub="One screen floor moved at a time, the other three held at today's values, the deck cap re-applied. Dashed line = the current setting. A report for retuning lib/config.ts, nothing on the deck reads it.">
        Threshold sweep
      </H>
      {sweepParams.length === 0 ? (
        <Card className="text-xs text-neutral-500">No sweep yet.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {sweepParams.map((p) => (
            <Card key={p}>
              <div className="text-[12px] font-semibold text-neutral-200">{SWEEP_LABEL[p].title}</div>
              <div className="mb-2 text-[11px] text-neutral-500">{SWEEP_LABEL[p].sub}</div>
              <SweepPanel points={sweep.filter((s) => s.param === p)} fmt={SWEEP_LABEL[p].fmt} />
            </Card>
          ))}
        </div>
      )}

      {/* ---------- 3. Themes ---------- */}
      <H id="themes" sub="Names that moved together over the last 63 sessions, grouped from price alone. Amber tickers are in tonight's deck. The job only clusters — the names are yours.">
        Themes
      </H>
      {clusters.length === 0 ? (
        <Card className="text-xs text-neutral-500">No clusters yet.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {clusters.slice(0, 24).map((c) => (
            <Card key={c.clusterId} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0 truncate">
                  <span className="font-mono text-[10px] text-neutral-600">C{String(c.clusterId).padStart(2, "0")}</span>{" "}
                  <span className="text-[12px] font-semibold text-neutral-100">{c.alias ?? c.leaders.join(" · ")}</span>
                </div>
                <span className={`font-mono text-[12px] font-semibold ${c.ret63d >= 0 ? "text-emerald-300" : "text-red-300"}`}>{pct(c.ret63d)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-neutral-800">
                <div className="h-full rounded bg-amber-600" style={{ width: `${Math.min(100, Math.max(2, (c.ret63d / 0.6) * 100))}%` }} />
              </div>
              <div className="flex items-center justify-between text-[10px] text-neutral-500">
                <span>{c.memberCount} names{c.alias ? ` · ${c.leaders.join(" · ")}` : ""}</span>
                <span><b className="text-amber-300">{c.inDeck.length}</b> in tonight&apos;s deck</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {c.members.slice(0, 18).map((m) => (
                  <Link key={m} href={`/s/${m}`} className={`rounded px-1.5 py-px font-mono text-[10px] ${c.inDeck.includes(m) ? "bg-amber-900/50 text-amber-300" : "bg-neutral-800 text-neutral-500"}`}>{m}</Link>
                ))}
                {c.members.length > 18 && <span className="px-1 text-[10px] text-neutral-600">+{c.members.length - 18}</span>}
              </div>
              <ClusterAlias clusterKey={c.clusterKey} alias={c.alias} />
            </Card>
          ))}
        </div>
      )}

      {/* ---------- 4. Splits ---------- */}
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
                  <td className={`${NUM} ${s.gapPct > 0 ? "text-red-300" : "text-red-300"}`}>{pct(s.gapPct)}</td>
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
      {breadth.rows.length > 0 && (
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full">
            <thead><tr><th className={TH}>Date</th><th className={`${TH} text-right`}>Universe</th><th className={`${TH} text-right`}>% above 20d</th><th className={`${TH} text-right`}>% above 50d</th><th className={`${TH} text-right`}>% with 10 &gt; 20</th><th className={`${TH} text-right`}>63d highs</th><th className={`${TH} text-right`}>63d lows</th><th className={TH}>Index verdict</th></tr></thead>
            <tbody>
              {breadth.rows.slice(-5).reverse().map((r) => (
                <tr key={r.date} className="border-t border-neutral-800">
                  <td className={`${TD} font-mono`}>{r.date}</td>
                  <td className={NUM}>{r.universe}</td>
                  <td className={NUM}>{pc(r.pctAbove20)}</td>
                  <td className={NUM}>{pc(r.pctAbove50)}</td>
                  <td className={NUM}>{pc(r.pct10Over20)}</td>
                  <td className={NUM}>{r.newHighs}</td>
                  <td className={NUM}>{r.newLows}</td>
                  <td className={TD}>{r.marketBullish === null ? "—" : r.marketBullish ? <span className="text-emerald-300">Bullish</span> : <span className="text-red-300">Not bullish</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ---------- 6. Replay ---------- */}
      <H id="replay" sub="Every closed paper trade replayed under other exit rules on the stored bars. Highlighted: the current rule and the best. Drawdown is the worst dip of the cumulative P&L, as a share of the $10,000 start.">
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

      {/* ---------- runs ---------- */}
      <H id="runs" sub="One row per job. A job is skipped when it is already current for the latest scan; the Refresh button forces all six.">
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
    </main>
  );
}
