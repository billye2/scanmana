import Link from "next/link";
import SimChart from "@/components/SimChart";
import SimForm from "@/components/SimForm";
import TopNav from "@/components/TopNav";
import { CONFIG } from "@/lib/config";
import { findDarvasBox } from "@/lib/darvas";
import { etToday } from "@/lib/dates";
import { price as fmt } from "@/lib/format";
import { liveBundle } from "@/lib/intraday";
import { findPivot } from "@/lib/livermore";
import { loadBars } from "@/lib/scan";
import { planStop, type StopCandidate, type StopPlan } from "@/lib/stop-plan";
import type { Bar } from "@/lib/types";

export const metadata = { title: "Stop simulator — Scanmana" };
export const dynamic = "force-dynamic";

const K = CONFIG.PAPER.KULLAMAGI;
const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * /sim — a position opened without a plan: type the symbol and the entry, get the
 * stop Kullamägi's rules put there (lib/stop-plan.ts, the same function the Take
 * button's default comes from), the ladder of levels around it, the dollar risk
 * for the shares held, and the rest of the playbook with where the trade stands.
 * Reads the bar store (plus today's live quote when the entry is today); writes nothing.
 */
export default async function SimPage({ searchParams }: { searchParams: Promise<{ t?: string; p?: string; d?: string; n?: string }> }) {
  const sp = await searchParams;
  const today = etToday();
  const ticker = (sp.t ?? "").toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 10);
  const entry = Number(sp.p);
  const shares = Number(sp.n) >= 1 ? Math.floor(Number(sp.n)) : undefined;
  const dateParam = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : undefined;

  let plan: StopPlan | null = null;
  let error: string | null = null;
  let note: string | null = null;
  let bars: Bar[] = [];
  if (ticker && entry > 0) {
    if (dateParam && dateParam > today) error = `${dateParam} is in the future.`;
    else {
      try {
        bars = (await loadBars([ticker])).get(ticker) ?? [];
        const wantToday = !dateParam || dateParam === today;
        if (bars.length > 0 && wantToday && bars[bars.length - 1].date < today) {
          // The entry is today and the close is not stored yet: today's low comes from the live quote.
          try {
            const bundle = await liveBundle(ticker);
            bars = bundle.bars;
            note = bundle.provisional
              ? `today's bar is provisional — as of ${bundle.asOf}; the entry-day low is today's low so far`
              : `no session today yet; the entry day is the last stored session`;
          } catch (err) {
            note = `live quote unavailable (${err instanceof Error ? err.message : "error"}) — the entry day is the last stored session, ${bars[bars.length - 1].date}`;
          }
        }
        if (bars.length === 0) error = `No price history stored for ${ticker}. The bar store covers US-listed stocks and ETFs from the nightly feed.`;
        else {
          const r = planStop({ bars, entry, entryDate: dateParam ?? bars[bars.length - 1].date, shares });
          if ("error" in r) error = r.error;
          else plan = r;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : "Database not configured.";
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-3xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav subtitle="Stop simulator — a position opened without a plan, priced by Kullamägi's rules" />
      <SimForm initial={{ t: sp.t, p: sp.p, d: sp.d, n: sp.n }} today={today} />
      {!ticker || !(entry > 0) ? (
        <p className="mt-4 text-[13px] leading-relaxed text-neutral-400">
          Already in a trade with no plan? Type the symbol and what you paid. You get the stop the playbook would have set — the low
          of the day you bought, if that is within one average day&apos;s range — the levels around it, the dollars at risk for your
          share count, and the rest of the routine: half off at the day-4 open, stop to breakeven, the rest out on a close under the
          10-day average. Leave the date empty for a trade opened today. Nothing here is saved.
        </p>
      ) : error ? (
        <p className="mt-8 text-center text-sm text-neutral-500">{error}</p>
      ) : plan ? (
        <Result plan={plan} ticker={ticker} bars={bars} shares={shares} note={note} />
      ) : null}
      <p className="mt-6 text-[11px] text-neutral-600">
        Rules from <Link href="/help#paper" className="underline decoration-neutral-700 underline-offset-4">Help</Link>. The Take
        button on a card prices its stop with the same function, so this page and the paper book never disagree.
      </p>
    </main>
  );
}

function Result({ plan, ticker, bars, shares, note }: { plan: StopPlan; ticker: string; bars: Bar[]; shares?: number; note: string | null }) {
  const rec = plan.recommended;
  const s = plan.status;
  const ladder = [...plan.candidates].sort((a, b) => b.price - a.price);
  const last = bars[bars.length - 1];
  const cash = CONFIG.PAPER.MANUAL_START_CASH;
  const sma10 = plan.candidates.find((c) => c.key === "sma10")?.price ?? null;
  const breakevenOn = s?.breakevenStop !== null && s?.breakevenStop !== undefined;
  // Once the stop is hit nothing after that date applies; steps that would have come later say so.
  const over = (date: string | null) => !!s?.stoppedOut && (date === null || s.stoppedDate! < date);
  const moot = <Status tone="text-neutral-600">— stopped out first</Status>;
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-2xl font-bold tracking-tight">
          {ticker} <span className="text-base font-normal text-neutral-400">bought {fmt(plan.entry)} on {plan.entryDate}</span>
        </h2>
        <span className="text-right text-xs text-neutral-500">
          last {fmt(last.c)} · {last.date}
        </span>
      </div>
      {plan.snappedFrom && <p className="mt-1 text-[11px] text-amber-300">{plan.snappedFrom} was not a session; using {plan.entryDate}.</p>}
      {note && <p className="mt-1 text-[11px] text-sky-300/80">{note}</p>}
      {plan.warnings.map((w) => (
        <p key={w} className="mt-1 text-[11px] text-amber-300">
          {w}
        </p>
      ))}

      <SimChart bars={bars.slice(-CONFIG.CHART_BARS)} box={findDarvasBox(bars)} pivot={findPivot(bars)} entry={plan.entry} stop={rec.price} />

      {/* The recommendation */}
      <div className="mt-3 rounded-xl border border-red-400/30 bg-neutral-900 px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-neutral-400">Your stop · {rec.label.toLowerCase()}</span>
          <span className="font-mono text-xl font-semibold text-red-300">{fmt(rec.price)}</span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-neutral-300">{plan.reason}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          <Stat label="risk / share" value={fmt(rec.riskPerShare)} sub={pctOf(rec.riskPct)} />
          {shares ? (
            <Stat
              label={`risk on ${shares} sh`}
              value={`$${(rec.dollarRisk ?? 0).toFixed(0)}`}
              sub={`${pctOf(rec.pctOfCash ?? 0)} of $${cash.toLocaleString()}`}
              tone={(rec.pctOfCash ?? 0) > 0.02 ? "text-amber-300" : undefined}
            />
          ) : (
            <Stat label="1 R" value={fmt(rec.riskPerShare)} sub="per share" />
          )}
          <Stat label="shares for 1% risk" value={String(rec.sharesFor1Pct)} sub={`$${(cash * 0.01).toFixed(0)} at risk`} tone={plan.cutSizeTo !== null ? "text-amber-300" : undefined} />
        </div>
      </div>

      {/* The ladder */}
      <h3 className="mt-5 mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">Levels under and around the entry</h3>
      <table className="w-full text-xs">
        <thead className="text-[10px] text-neutral-500 uppercase">
          <tr>
            <th className="py-1 text-left font-medium">level</th>
            <th className="py-1 text-right font-medium">price</th>
            <th className="py-1 text-right font-medium">risk</th>
            <th className="py-1 text-right font-medium">{shares ? `$ on ${shares}` : "sh for 1%"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {ladder.map((c) => (
            <LadderRow key={c.key} c={c} recommended={c.key === rec.key} shares={shares} />
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-neutral-600">
        Amber: farther than one average day&apos;s range ({plan.adrPct !== null ? `${plan.adrPct.toFixed(1)}%` : "unknown"}). Grey: not under the entry,
        or an average shown for the trail.
      </p>

      {/* The playbook */}
      <h3 className="mt-5 mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">The rest of the playbook{s ? ` · day ${s.sessionsHeld}` : ""}</h3>
      <ol className="space-y-2 text-[13px] leading-relaxed text-neutral-300">
        <Step n={1} title={`Stop ${fmt(rec.price)}`}>
          {s ? (
            s.stoppedOut ? (
              <Status tone="text-red-300">
                hit on {s.stoppedDate} — the trade is over at {breakevenOn && s.stoppedDate! >= (s.partialDate ?? "") ? "breakeven on the rest" : "−1R"}; nothing left to plan
              </Status>
            ) : (
              <Status tone="text-emerald-300">
                not touched since entry · last close {fmt(s.current)}
                {s.unrealisedR !== null ? ` · ${s.unrealisedR >= 0 ? "+" : ""}${s.unrealisedR.toFixed(2)}R open` : ""}
              </Status>
            )
          ) : (
            <Status>a sell-stop for the whole position from the next session. Never lower it.</Status>
          )}
        </Step>
        <Step n={2} title={`Sell ${Math.round(K.PARTIAL_FRACTION * 100)}% at the open of day ${K.PARTIAL_DAY} if day ${K.PARTIAL_DAY - 1} closes above ${fmt(plan.entry)}`}>
          {s && s.partialDue !== "pending" && over(s.partialDate) ? (
            moot
          ) : !s || s.partialDue === "pending" ? (
            <Status>{s ? `day ${s.sessionsHeld} of ${K.PARTIAL_DAY - 1}; the entry day counts as day 1` : "the entry day counts as day 1"}</Status>
          ) : s.partialDue === "due" ? (
            <Status tone="text-emerald-300">
              day {K.PARTIAL_DAY - 1} closed above the entry — half goes at the {s.partialDate} open{shares ? ` (${Math.floor(shares * K.PARTIAL_FRACTION)} shares)` : ""}
            </Status>
          ) : (
            <Status tone="text-amber-300">day {K.PARTIAL_DAY - 1} closed under the entry — no partial; the full size rides on the stop</Status>
          )}
        </Step>
        <Step n={3} title={`Then move the stop to breakeven, ${fmt(plan.entry)}`}>
          {breakevenOn && over(s!.partialDate) ? (
            moot
          ) : (
            <Status tone={breakevenOn ? "text-emerald-300" : undefined}>{breakevenOn ? `in force from the ${s!.partialDate} open` : "only after the partial fills"}</Status>
          )}
        </Step>
        <Step n={4} title={`Sell the rest at the next open after a close under the ${K.MA}-day average${sma10 !== null ? `, now ${fmt(sma10)}` : ""}`}>
          {s?.maExitDue && over(s.maExitDate) ? (
            moot
          ) : s?.maExitDue ? (
            <Status tone="text-amber-300">
              {s.maExitDate} closed under its {K.MA}-day average — the rest goes at the next open
            </Status>
          ) : (
            <Status>{s ? "no close under the average yet" : "the trail; no lowest-low stop in this playbook"}</Status>
          )}
        </Step>
      </ol>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-neutral-800/60 px-2 py-1.5">
      <div className="text-[10px] text-neutral-500 uppercase">{label}</div>
      <div className={`font-mono text-sm font-semibold ${tone ?? "text-neutral-100"}`}>{value}</div>
      <div className="text-[10px] text-neutral-500">{sub}</div>
    </div>
  );
}

function LadderRow({ c, recommended, shares }: { c: StopCandidate; recommended: boolean; shares?: number }) {
  const tone = !c.usable ? "text-neutral-500" : c.wide ? "text-amber-300" : "text-neutral-200";
  return (
    <tr className={recommended ? "bg-red-400/10" : ""}>
      <td className={`py-1.5 pr-2 ${tone}`}>
        <span className={recommended ? "font-semibold text-neutral-100" : ""}>{c.label}</span>
        <span className="block text-[10px] text-neutral-500">{c.note}</span>
      </td>
      <td className={`py-1.5 text-right font-mono ${tone}`}>{fmt(c.price)}</td>
      <td className={`py-1.5 text-right font-mono ${tone}`}>{c.usable ? pctOf(c.riskPct) : "—"}</td>
      <td className={`py-1.5 text-right font-mono ${tone}`}>{c.usable ? (shares ? `$${(c.dollarRisk ?? 0).toFixed(0)}` : c.sharesFor1Pct) : "—"}</td>
    </tr>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-800 font-mono text-[11px] text-neutral-400">{n}</span>
      <div>
        <div className="text-neutral-100">{title}</div>
        {children}
      </div>
    </li>
  );
}

function Status({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <div className={`text-[11px] ${tone ?? "text-neutral-500"}`}>{children}</div>;
}
