import Link from "next/link";
import { BreadthLine, BucketBars, RateBars, SweepPanel } from "@/components/ResearchCharts";
import { ClusterAlias } from "@/components/ResearchControls";
import Band from "@/components/Band";
import { Card, H, NUM, SUMMARY, TD, TH, n, pc, rr } from "@/components/ResearchPrimitives";
import { meanInterval, wilson } from "@/lib/stats";
import TopNav from "@/components/TopNav";
import { pct } from "@/lib/format";
import {
  EP_NEGLECT_RET_3M,
  SWEEP_CURRENT,
  getBreadth,
  getClusters,
  getEpStudy,
  getKullamagiStudy,
  getResearchSummary,
  getSweep,
  getThemeStudy,
} from "@/lib/research";
import { MIN_AFTER_N, sweepHeadline } from "@/lib/research-story";
import { latestScanSlim } from "@/lib/scan";

export const metadata = { title: "Studies — Scanmana" };
export const dynamic = "force-dynamic";

const SWEEP_LABEL: Record<string, { title: string; sub: string; fmt: (v: number) => string }> = {
  MIN_DOLLAR_VOLUME: { title: "MIN_DOLLAR_VOLUME", sub: `20-day avg $ volume floor · now $${SWEEP_CURRENT.MIN_DOLLAR_VOLUME / 1e6}M`, fmt: (v) => `$${Math.round(v / 1e6)}M` },
  MIN_ADR_PCT: { title: "MIN_ADR_PCT", sub: `Average daily range floor · now ${SWEEP_CURRENT.MIN_ADR_PCT}% (permanent)`, fmt: (v) => `${v}%` },
  MAX_DIST_FROM_HIGH: { title: "MAX_DIST_FROM_HIGH", sub: `Within this of the 6-month high · now ${SWEEP_CURRENT.MAX_DIST_FROM_HIGH * 100}%`, fmt: (v) => `${Math.round(v * 100)}%` },
  MIN_PRICE: { title: "MIN_PRICE", sub: `Price floor · now $${SWEEP_CURRENT.MIN_PRICE} (scan-night close only)`, fmt: (v) => `$${v}` },
};

/**
 * /studies — the research layer's deeper reads (1.7.5), moved off /research so
 * that page keeps to the verdict, the scorecard and the rule changes (Billy's
 * call, 2026-11-03). Everything here is a study: it reads the research tables
 * and changes nothing. In order: the plan on history, breakout rates, the EP
 * study, the threshold sweep, breadth, tonight's themes, themes scored.
 */
export default async function StudiesPage() {
  const scan = await latestScanSlim().catch(() => null);
  const deckTickers = scan?.candidates.map((c) => c.ticker) ?? [];
  const [summary, sweep, clusters, breadth, ep, plan, themeStudy] = await Promise.all([
    getResearchSummary(),
    getSweep(),
    getClusters(deckTickers),
    getBreadth(120),
    getEpStudy(),
    getKullamagiStudy(),
    getThemeStudy(),
  ]);
  const sweepParams = Object.keys(SWEEP_LABEL).filter((p) => sweep.some((s) => s.param === p));
  const headline = sweepHeadline(sweep);
  const themes = clusters.filter((c) => c.inDeck.length >= 2).sort((a, b) => b.inDeck.length - a.inDeck.length || b.ret63d - a.ret63d).slice(0, 8);
  const epGroups = [ep.overall, ...ep.byNeglect, ...ep.byVolume, ...ep.byHeld, ...ep.byBoth];
  const epReady = ep.overall.n >= MIN_AFTER_N;

  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-5xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/studies" subtitle={summary.lastDate ? `Studies · ${summary.scans} scans · ${summary.firstDate} → ${summary.lastDate}` : "Studies"} />

      <p className="text-[13px] leading-relaxed text-neutral-300">
        The research layer&apos;s deeper reads: what the scanner&apos;s own history says about the plan, the screen, the tape and the themes.
        Each is a study — it reads the nightly tables and changes nothing; a rule changes only when a study says so, and then it is scored on{" "}
        <Link href="/research" className="text-neutral-100 underline underline-offset-4">Research</Link>. Terms in{" "}
        <Link href="/help#studies" className="text-neutral-100 underline underline-offset-4">Help</Link>. Grey means fewer than {MIN_AFTER_N} rows; the thin bar under a number is its 95% range — where two bars overlap, the gap between them is not yet a finding.
      </p>

      {/* ---------- 1. Kullamägi's plan on history ---------- */}
      <H id="plan" sub={`Every boxed Wait card that closed under its box top on scan night (${n(plan.rows)} rows), traded two ways on the stored bars and sold by the Auto book's routine: the book's own entry — the open after the first close above the box within ten sessions, stop at that day's low — and a resting buy-stop at the box top with the stop one ADR under the fill. The stop-width table decided the book's one-ADR skip (1.6.3, 2026-11-03: ≤1 ADR +0.06R on 483, wider −0.19R on 268 — the rule-change row scores it from here); the entry table decides which entry it keeps.`}>
        Kullamägi&apos;s plan on every boxed Wait card
      </H>
      <div className="grid gap-3 md:grid-cols-3">
        {(
          [
            ["By stop width · next-open entry", plan.byWidth, "Width"],
            ["By the card's ADR · next-open entry", plan.byAdr, "ADR"],
            ["Entry against entry", plan.byEntry, "Entry"],
          ] as const
        ).map(([title, groups, head]) => (
          <Card key={title} className="overflow-x-auto p-0">
            <div className="px-2 pt-2 text-[11px] font-semibold text-neutral-400">{title}</div>
            <table className="w-full">
              <thead><tr><th className={TH}>{head}</th><th className={`${TH} text-right`}>Trades</th><th className={`${TH} text-right`}>Win</th><th className={`${TH} text-right`}>Avg R</th>{head === "Entry" && <th className={`${TH} text-right`}>Filled</th>}</tr></thead>
              <tbody>
                {groups.map((g) => {
                  const ready = g.n >= MIN_AFTER_N;
                  return (
                    <tr key={g.key} className={`border-t border-neutral-800 ${ready ? "" : "text-neutral-500"}`}>
                      <td className={`${TD} whitespace-normal ${ready ? "text-neutral-100" : ""}`}>{g.label}</td>
                      <td className={NUM}>{n(g.n)}</td>
                      <td className={NUM}><Band text={pc(g.winRate)} value={g.winRate} interval={wilson(g.winRate, g.n)} kind="rate" tone="" /></td>
                      <td className={`${NUM} ${ready && g.avgR !== null ? (g.avgR >= 0 ? "text-emerald-300" : "text-red-300") : ""}`}>
                        <Band text={rr(g.avgR)} value={g.avgR} interval={meanInterval(g.avgR, g.sdR, g.n)} kind="r" tone="" />
                      </td>
                      {head === "Entry" && <td className={NUM}>{pc(g.filled)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      {/* ---------- 2. Breakout rates ---------- */}
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

      {/* ---------- 3. Episodic pivots ---------- */}
      <H id="ep" sub={`Kullamägi's main setup, which the deck cannot show: a gap of 10%+ on 3× volume in the whole market (price ≥ $10, ≥ $20M/day), bought at the next open with the stop at the gap day's low and sold by the Auto book's routine. ${n(ep.candidates)} gap days${ep.firstDate ? ` since ${ep.firstDate}` : ""}, ${n(ep.taken)} tradeable, ${n(ep.labelled)} with a result. A study only — nothing is armed from it.`}>
        Episodic pivots, had the book traded them
      </H>
      {ep.candidates === 0 ? (
        <Card className="text-xs text-neutral-500">No gap days scored yet — the ep job fills this after the next research run.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_300px]">
          <Card className="overflow-x-auto p-0">
            <table className="w-full">
              <thead><tr><th className={TH}>Group</th><th className={`${TH} text-right`}>Trades</th><th className={`${TH} text-right`}>Win</th><th className={`${TH} text-right`}>Avg R</th><th className={`${TH} text-right`}>Best close in 20</th></tr></thead>
              <tbody>
                {epGroups.map((g, i) => (
                  <tr key={g.key} className={`border-t border-neutral-800 ${g.key === "all" ? "bg-amber-900/15" : g.key === "both" ? "bg-emerald-900/15" : ""} ${g.n < MIN_AFTER_N ? "text-neutral-500" : ""}`}>
                    <td className={`${TD} whitespace-normal ${g.n >= MIN_AFTER_N ? "text-neutral-100" : ""}`}>{g.label}{i === 1 && <span className="ml-1 text-[10px] text-neutral-500">before the gap</span>}</td>
                    <td className={NUM}>{n(g.n)}</td>
                    <td className={NUM}>{pc(g.winRate)}</td>
                    <td className={`${NUM} ${g.n >= MIN_AFTER_N && g.avgR !== null ? (g.avgR >= 0 ? "text-emerald-300" : "text-red-300") : ""}`}>{rr(g.avgR)}</td>
                    <td className={NUM}>{g.avgMfe20 === null ? "—" : pct(g.avgMfe20)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
              {epReady
                ? "Neglected should beat already-up and 10×+ should beat 3–5×, as he says. If neglected 10×+ pays and the rest does not, an EP list earns its place on the deck; if nothing pays at the next open, the gap-day entry his method needs is not available to end-of-day data and the study stays a study."
                : `Grey until a group has ${MIN_AFTER_N} results; one night's run labels the whole stored history, so the first read is immediate.`}
            </p>
          </Card>
          <Card>
            <div className="mb-1 text-[11px] font-semibold text-neutral-400">Latest gap days</div>
            <table className="w-full">
              <tbody>
                {ep.recent.map((r) => (
                  <tr key={`${r.ticker}-${r.date}`} className="border-t border-neutral-800 first:border-t-0">
                    <td className={`${TD} px-1 py-1 font-semibold text-neutral-100`}><Link href={`/s/${r.ticker}`} className="underline decoration-neutral-700 underline-offset-4">{r.ticker}</Link></td>
                    <td className={`${TD} px-1 py-1 font-mono text-[10px] text-neutral-500`}>{r.date.slice(5)}</td>
                    <td className={`${NUM} px-1 py-1`}>{pct(r.gapPct)}</td>
                    <td className={`${NUM} px-1 py-1`}>{r.volMult === null ? "—" : `${r.volMult.toFixed(0)}×`}</td>
                    <td className={`${TD} px-1 py-1 text-[10px] ${r.ret3mBefore !== null && r.ret3mBefore < EP_NEGLECT_RET_3M ? "text-emerald-300" : "text-neutral-500"}`}>{r.ret3mBefore === null ? "" : r.ret3mBefore < EP_NEGLECT_RET_3M ? "neglected" : "up already"}</td>
                    <td className={`${NUM} px-1 py-1 ${r.r === null ? "text-neutral-600" : r.r >= 0 ? "text-emerald-300" : "text-red-300"}`}>{r.taken === false ? "not taken" : r.r === null ? "open" : rr(r.r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ---------- 4. Sweep ---------- */}
      <H id="sweep" sub="One screen floor moved at a time, the other three held at today's values, the deck cap re-applied. A report for retuning lib/config.ts, nothing on the deck reads it. The ADR floor is 3.5% for good (1.6.5), whatever its curve says.">
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
                {SWEEP_LABEL[headline.param].fmt(headline.best.value)} would have been {pc(headline.best.hitRate)} <span className="text-neutral-500">(n={n(headline.best.n)})</span>. One change at a time; score it on Research before the next.
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
      <H id="breadth" sub="Share of the universe (price ≥ $5, ≥ $5M/day) above its 20-day average. Green bands: sessions the index verdict called Bullish. Right: the deck's 10-session hit rate by the breadth on scan night. The tape page has the full read.">
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
      <H id="themes" sub="Groups that moved together over the last 63 sessions, from price alone, with two or more names in tonight's deck. Amber tickers are on the deck. Membership is saved nightly; the card below scores it.">
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

      {/* ---------- 7. Themes, scored (1.7.4) ---------- */}
      <H
        id="themes-scored"
        sub={
          themeStudy.since
            ? `Every deck row since membership began saving nightly (${themeStudy.since}, ${themeStudy.nights} nights; ${n(themeStudy.inTheme)} of ${n(themeStudy.deckRows)} deck rows sat in a theme), scored by the theme it sat in that night. Left: by how many other deck names shared the theme — Kullamägi's claim is that leaders move in groups, so the 4+ row should break out most often. Right: per theme by its key (the sorted leaders; a theme continues under a new key when a leader changes, and "nights" says how long a key held).`
            : "The clusters job has not saved a night of membership yet."
        }
      >
        Themes, scored
      </H>
      {themeStudy.since && (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
          <Card className="overflow-x-auto p-0">
            <table className="w-full">
              <thead>
                <tr><th className={TH}>Deck-mates that night</th><th className={`${TH} text-right`}>Rows</th><th className={`${TH} text-right`}>Broke out</th><th className={`${TH} text-right`}>Auto plan</th></tr>
              </thead>
              <tbody>
                {themeStudy.byMates.map((b) => {
                  const grey = b.n < MIN_AFTER_N;
                  return (
                    <tr key={b.key} className="border-t border-neutral-800">
                      <td className={TD}>{b.label}</td>
                      <td className={NUM}>{n(b.n)}</td>
                      <td className={`${NUM} ${grey ? "text-neutral-500" : "text-neutral-100"}`}><Band text={pc(b.hitRate)} value={b.hitRate} interval={wilson(b.hitRate, b.n)} kind="rate" tone="" /></td>
                      <td className={`${NUM} ${b.kN < MIN_AFTER_N ? "text-neutral-500" : "text-neutral-100"}`}>
                        <Band text={rr(b.avgKR)} value={b.avgKR} interval={meanInterval(b.avgKR, b.sdKR, b.kN)} kind="r" tone="" /><span className="text-neutral-600"> · {b.kN}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Card className="overflow-x-auto p-0">
            <table className="w-full">
              <thead>
                <tr><th className={TH}>Theme</th><th className={`${TH} text-right`}>Nights</th><th className={`${TH} text-right`}>Rows</th><th className={`${TH} text-right`}>Broke out</th><th className={`${TH} text-right`}>Auto plan</th></tr>
              </thead>
              <tbody>
                {themeStudy.themes.length === 0 && (
                  <tr><td colSpan={5} className={`${TD} text-neutral-500`}>No theme has eight scored deck rows yet.</td></tr>
                )}
                {themeStudy.themes.map((t) => {
                  const grey = t.n < MIN_AFTER_N;
                  return (
                    <tr key={t.clusterKey} className="border-t border-neutral-800">
                      <td className={`${TD} whitespace-normal`}>
                        {t.alias && <span className="mr-1.5 font-semibold text-neutral-100">{t.alias}</span>}
                        <span className="inline-flex flex-wrap gap-1">
                          {t.leaders.map((m) => (
                            <Link key={m} href={`/s/${m}`} className="rounded bg-neutral-800 px-1.5 py-px font-mono text-[10px] text-neutral-300">{m}</Link>
                          ))}
                        </span>
                        {t.current && <span className="ml-1.5 rounded-full bg-emerald-950 px-1.5 py-px text-[10px] font-semibold text-emerald-300">tonight</span>}
                        <span className="ml-1.5 text-[10px] text-neutral-600">{t.first.slice(5)} → {t.last.slice(5)}</span>
                      </td>
                      <td className={NUM}>{t.nights}</td>
                      <td className={NUM}>{t.n}</td>
                      <td className={`${NUM} ${grey ? "text-neutral-500" : "text-neutral-100"}`}><Band text={pc(t.hitRate)} value={t.hitRate} interval={wilson(t.hitRate, t.n)} kind="rate" tone="" /></td>
                      <td className={`${NUM} ${t.kN < MIN_AFTER_N ? "text-neutral-500" : "text-neutral-100"}`}>
                        <Band text={rr(t.avgKR)} value={t.avgKR} interval={meanInterval(t.avgKR, t.sdKR, t.kN)} kind="r" tone="" /><span className="text-neutral-600"> · {t.kN}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <p className="mt-8 text-[11px] text-neutral-600">Levels on this page are scan-night values. Splits, the paper replay and the job log are under Maintenance on <Link href="/research" className="underline underline-offset-4">Research</Link>.</p>
    </main>
  );
}
