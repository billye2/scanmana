import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import Band from "@/components/Band";
import MarketBar from "@/components/MarketBar";
import { meanInterval, wilson } from "@/lib/stats";
import { BreadthLines, HighsLows } from "@/components/TapeCharts";
import { BucketBars } from "@/components/ResearchCharts";
import TopNav from "@/components/TopNav";
import { CONFIG } from "@/lib/config";
import { getBreadth, getTapeStudy, latestBreadth } from "@/lib/research";
import IndexCharts from "@/components/IndexCharts";
import { liveIndexBars } from "@/lib/intraday";
import { morningBook } from "@/lib/paper-db";
import { briefText, morningBrief } from "@/lib/paper-engine";
import { latestScanSlim } from "@/lib/scan";
import { latestTape, tapeMultiplier } from "@/lib/tape";
import { tapeStance, tapeWindow, verdictStreak } from "@/lib/tape-read";
import type { ChartLine } from "@/components/Chart";
import { trendRead, type TrendLevel, type TrendTone } from "@/lib/trend-read";

export const metadata = { title: "Tape — Scanmana" };
export const dynamic = "force-dynamic";

const WINDOWS = [
  { key: "60", label: "60 sessions" },
  { key: "120", label: "120 sessions" },
  { key: "250", label: "250 sessions" },
] as const;
type Win = (typeof WINDOWS)[number]["key"];
const DEFAULT_WIN: Win = "120";
const T = CONFIG.PAPER.TAPE;

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl bg-neutral-900 p-3 ${className}`}>{children}</div>
);
const H = ({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="mt-6 mb-2">
    <h2 className="text-sm font-semibold tracking-wide text-emerald-400 uppercase">{children}</h2>
    {sub && <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">{sub}</p>}
  </div>
);
const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const rr = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`);
const TREND_TONE: Record<TrendTone, string> = { up: "text-emerald-300", mixed: "text-amber-300", down: "text-red-300" };
const LEVEL_LINE: Record<TrendLevel["kind"], Pick<ChartLine, "color" | "style">> = {
  better: { color: "#34d399", style: "dashed" },
  worse: { color: "#f87171", style: "dashed" },
  test: { color: "#fbbf24", style: "dotted" },
  range: { color: "#a3a3a3", style: "dashed" },
};
const SIZE_TONE = { full: "text-emerald-300", half: "text-amber-300", quarter: "text-red-300" } as const;
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mt-2 border-t border-neutral-800 pt-2">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
    <div className="mt-0.5 space-y-0.5 text-xs leading-snug text-neutral-200">{children}</div>
  </div>
);

/**
 * /tape — whether to trade at all (1.7.0). Kullamägi's index filter and market
 * breadth, which the home strip shows for tonight only, over time: how long the
 * verdict has held, where breadth is going, the sizing the book takes from them,
 * and what the deck did under each verdict. Reads scan_results, research_breadth,
 * scan_history × research_outcomes; writes nothing.
 */
export default async function TapePage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const sp = await searchParams;
  const win: Win = sp.d === "60" || sp.d === "250" ? sp.d : DEFAULT_WIN;
  const [scan, breadthNow, { rows, buckets }, study, tape, live] = await Promise.all([
    latestScanSlim().catch(() => null),
    latestBreadth().catch(() => null),
    getBreadth(Number(win)),
    getTapeStudy(),
    latestTape(),
    liveIndexBars().catch(() => null),
  ]);
  // The words stay on the stored close; the charts under them follow the day like Help's.
  const trend = live ? trendRead(live.stored) : null;
  const streak = verdictStreak(rows);
  const window = tapeWindow(rows);
  const stance = tapeStance(streak, window, tape);
  // The prices the box and the card name, as lines on that index's chart.
  const levels: Record<string, ChartLine[]> = Object.fromEntries(
    (trend?.indices ?? []).map((ix) => [ix.ticker, ix.levels.map((l) => ({ price: l.price, title: l.label, ...LEVEL_LINE[l.kind] }))]),
  );
  // The reader's own book in one line, as the home page has it. Its own catch: the page renders without it.
  const { userId } = await auth();
  const book = userId
    ? await morningBook(userId)
        .then((mb) => briefText(morningBrief(mb.orders, mb.positions, tape.label)))
        .catch(() => null)
    : null;
  const sizes: { label: string; signals: string; mult: number }[] = [
    { label: "Full", signals: "index Bullish and breadth at or above " + Math.round(T.BREADTH_MIN * 100) + "%", mult: 1 },
    { label: "Half", signals: "one of the two", mult: T.ONE_SIGNAL },
    { label: "Quarter", signals: "neither", mult: T.NO_SIGNAL },
  ];

  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-5xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[calc(env(safe-area-inset-bottom)+80px)] lg:pb-6">
      <TopNav current="/tape" subtitle={scan?.date ? `Tape · as of ${scan.date}` : "Tape"} />

      <MarketBar market={scan?.market} breadth={breadthNow} />

      <Card>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
          Tomorrow{trend && <span className="font-normal normal-case tracking-normal text-neutral-500"> · from the {trend.date} close</span>}
        </div>
        <p className="mt-0.5 text-base font-semibold leading-snug">
          <span className={SIZE_TONE[stance.size]}>{stance.title}</span>
          <span className="ml-2 text-xs font-normal text-neutral-400">{stance.why}</span>
        </p>
        <p className="mt-0.5 text-xs leading-snug text-neutral-400">{stance.context}</p>
        {trend && (
          <>
            <Row label="Gets better at">
              {trend.better.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </Row>
            <Row label="Gets worse at">
              {trend.worse.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </Row>
          </>
        )}
        {book && (
          <Row label="Your book at the open">
            <p>
              <Link href="/paper" className="underline decoration-neutral-700 underline-offset-4">{book}</Link>
            </p>
          </Row>
        )}
      </Card>

      {trend && (
        <Card className="mt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">The trend, read</div>
          <p className={`mt-0.5 text-sm font-semibold leading-snug ${TREND_TONE[trend.tone]}`}>{trend.headline}</p>
          {trend.indices.map((ix) => (
            <div key={ix.ticker} className="mt-2">
              <div className="text-[11px] font-semibold text-neutral-400">{ix.ticker}</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs leading-snug text-neutral-200 marker:text-neutral-600">
                {ix.key.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
          <details className="group mt-2 border-t border-neutral-800 pt-2">
            <summary className="cursor-pointer list-none text-[11px] font-semibold text-neutral-400 active:text-neutral-200">
              All the facts <span className="font-normal text-neutral-600 group-open:hidden">· averages, the last bounce, the repair order</span>
            </summary>
            {trend.indices.map((ix) => (
              <div key={ix.ticker} className="mt-2">
                <div className="text-[11px] font-semibold text-neutral-400">{ix.ticker}</div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs leading-snug text-neutral-300 marker:text-neutral-600">
                  {ix.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="mt-2 text-[11px] font-semibold text-neutral-400">The repair order</div>
            <ol className="mt-0.5 list-decimal space-y-0.5 pl-5 text-xs leading-snug text-neutral-300 marker:text-neutral-600">
              {trend.ladder.map((step) => (
                <li key={step.say}>
                  {step.say}
                  {step.fail.length === 0 ? <span className="text-emerald-400"> · done</span> : <span className="text-neutral-500"> · still open on {step.fail.join(" and ")}</span>}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-neutral-600">Written by fixed rules from the stored daily bars; the same tape always reads the same way.</p>
          </details>
        </Card>
      )}

      {live && live.bars.size > 0 && (
        <>
          <H sub="The last 30 sessions (tap the pill for the full window) with the prices named above drawn on them: green dashed the close that gets better, red dashed a support, amber dotted a level under test, grey a range's ends.">
            SPY and QQQ
          </H>
          <IndexCharts
            bars={live.bars}
            health={live.health.length > 0 ? live.health : scan?.market?.indices}
            asOf={live.asOf}
            provisional={live.provisional}
            levels={levels}
            defaultZoomed
            compact
          />
        </>
      )}

      <H sub={`Share of the universe (price ≥ $5, ≥ $5M a day) above its 20-day average (amber), above its 50-day (sky) and with the 10-day over the 20-day (green). Green bands: sessions the index verdict called Bullish. The dashed line is the ${Math.round(T.BREADTH_MIN * 100)}% the sizing rule reads.`}>
        Breadth and the verdict
      </H>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Window">
        {WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={w.key === DEFAULT_WIN ? "/tape" : `/tape?d=${w.key}`}
            role="tab"
            aria-selected={w.key === win}
            className={`rounded-full px-3 py-1 text-xs ${w.key === win ? "bg-neutral-100 font-semibold text-neutral-900" : "bg-neutral-900 text-neutral-400 active:bg-neutral-800"}`}
          >
            {w.label}
          </Link>
        ))}
        <span className="ml-auto text-[11px] text-neutral-500">{rows.length} sessions shown</span>
      </div>
      <Card className="mt-2"><BreadthLines rows={rows} /></Card>
      <Card className="mt-2">
        <div className="mb-1 text-[11px] font-semibold text-neutral-400">New highs (up) against new lows (down)</div>
        <HighsLows rows={rows} />
      </Card>

      <details className="group mt-6 rounded-xl bg-neutral-900/50 px-3 py-2">
        <summary className="cursor-pointer list-none text-sm font-semibold tracking-wide text-emerald-400 uppercase active:opacity-70">
          How this is scored
          <span className="ml-2 text-[11px] font-normal normal-case tracking-normal text-neutral-500 group-open:hidden">the sizing rule, what the deck did under each verdict</span>
        </summary>
      <p className="mt-2 text-[13px] leading-relaxed text-neutral-300">
        His first rule is that the index decides whether breakouts work at all; breadth says how many names are taking part. The home
        strip shows tonight&apos;s reading; this page shows the run of them, so a Bullish call can be seen as a streak and not a flicker.
        Terms in <Link href="/help#tape" className="text-neutral-100 underline underline-offset-4">Help</Link>.
      </p>

      <H sub="The paper book scales its $ notional by how many of the two signals hold at fill time. Breadth is the prior session's, written after the book runs. Sizing changes dollars, not R.">
        Size by the tape
      </H>
      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Size</th>
              <th className="px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">When</th>
              <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Notional</th>
            </tr>
          </thead>
          <tbody>
            {sizes.map((s) => {
              const now = tape.label === s.label.toLowerCase();
              return (
                <tr key={s.label} className={`border-t border-neutral-800 ${now ? "bg-emerald-950/40" : ""}`}>
                  <td className={`px-2 py-1.5 text-xs ${now ? "font-semibold text-emerald-300" : "text-neutral-300"}`}>{s.label}{now ? " · tonight" : ""}</td>
                  <td className="px-2 py-1.5 text-xs text-neutral-400">{s.signals}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-neutral-300">${Math.round(CONFIG.PAPER.NOTIONAL * s.mult)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-[11px] text-neutral-500">
        Tonight: {tapeMultiplier(tape.bullish, tape.breadth).reason}. A signal the app does not know yet is left out, not counted against the trade.
      </p>

      <H sub="Every scored deck row since the history began, by the index verdict on its scan night: how often it closed above its level within ten sessions, and the Auto plan's average R on the boxed Wait rows among them. Under it: the same breakout rate by the breadth that night.">
        What the deck did under each verdict
      </H>
      <div className="grid gap-3">
        <Card className="overflow-x-auto p-0">
          <table className="w-full">
            <thead>
              <tr>
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Scan night</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Deck rows</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Broke out</th>
                <th className="px-2 py-1.5 text-right text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Auto plan</th>
              </tr>
            </thead>
            <tbody>
              {study.length === 0 && (
                <tr><td colSpan={4} className="px-2 py-3 text-xs text-neutral-500">No scored rows yet.</td></tr>
              )}
              {study.map((r) => (
                <tr key={String(r.bullish)} className="border-t border-neutral-800">
                  <td className={`px-2 py-1.5 text-xs font-semibold ${r.bullish === null ? "text-neutral-500" : r.bullish ? "text-emerald-300" : "text-red-300"}`}>
                    {r.bullish === null ? "No verdict stored" : r.bullish ? "Bullish" : "Not bullish"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-neutral-300">{r.n.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-neutral-100"><Band text={pc(r.hitRate)} value={r.hitRate} interval={wilson(r.hitRate, r.n)} kind="rate" tone="" /></td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-neutral-300">
                    <Band text={rr(r.avgKR)} value={r.avgKR} interval={meanInterval(r.avgKR, r.sdKR, r.kN)} kind="r" tone="" /><span className="text-neutral-500"> on {r.kN}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <div className="mb-1 text-[11px] font-semibold text-neutral-400">Breakout rate by breadth</div>
          <BucketBars buckets={buckets} />
        </Card>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
        In-sample, one tape so far; the research page scores the sizing rule itself under &ldquo;Paper size scaled by the tape&rdquo;. Nothing here changes a scan.
        The highs-and-lows count is the universe&apos;s new 52-week highs and lows per session as the breadth job records them.
      </p>
      </details>
    </main>
  );
}
