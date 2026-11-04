"use client";

import { useState } from "react";
import Link from "next/link";
import LiveChip from "@/components/LiveChip";
import { useLive } from "@/components/useLive";
import { price, pct } from "@/lib/format";
import { BUCKET_ORDER, type LiveDeckBundle, type LiveWatchRow } from "@/lib/livewatch";
import { OPEN_GROUPS, type OpenGroup } from "@/lib/plan-line";
import type { DeckCard } from "@/lib/types";
import { verdictChip, verdictLabel } from "@/lib/verdict";

const LIVE_PREF = "scanmana.deckListLive";

function readPref(): boolean {
  try {
    const v = localStorage.getItem(LIVE_PREF);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

/** What the page computed per card from the Auto book's own arming test (`openGroup` / `openHint` in lib/plan-line.ts). */
export type DeckPlan = Record<string, { group: OpenGroup; hint: string | null }>;

type Filter = "wait" | "pass" | "saved" | null;

const HEAD_TONE: Record<OpenGroup, string> = {
  arms: "text-emerald-400",
  inside: "text-neutral-400",
  watch: "text-neutral-400",
  pass: "text-neutral-500",
};

/**
 * Tonight's deck as one page, grouped by what happens at the open: the names
 * the Auto book arms tonight, the Wait cards still inside their box (closest to
 * the trigger first), the Wait cards it cannot arm, and the Pass cards folded
 * away. The tally chips filter. While quotes are available the Live toggle
 * orders each group by what price is doing and swaps the verdict chip for the
 * live read. Tap a row to open that card on the home deck.
 */
export default function DeckLiveList({ candidates, saved, plan }: { candidates: DeckCard[]; saved: string[]; plan: DeckPlan }) {
  const { data: live, err } = useLive<LiveDeckBundle>("/api/scan/live");
  const [liveView, setLiveView] = useState(readPref);
  const [filter, setFilter] = useState<Filter>(null);
  const [passOpen, setPassOpen] = useState(false);
  const savedSet = new Set(saved);

  const showLive = liveView && !!live && live.rows.length > 0;
  const toggleLive = () => {
    const next = !liveView;
    setLiveView(next);
    try { localStorage.setItem(LIVE_PREF, next ? "1" : "0"); } catch { /* private mode etc. */ }
  };
  const toggleFilter = (f: Filter) => setFilter((cur) => (cur === f ? null : f));

  const liveRow = new Map<string, LiveWatchRow>(showLive && live ? live.rows.map((r) => [r.ticker, r]) : []);
  const groupOf = (c: DeckCard): OpenGroup => plan[c.ticker]?.group ?? (c.verdict === "wait" ? "watch" : "pass");

  const nWait = candidates.filter((c) => c.verdict === "wait").length;
  const nPass = candidates.length - nWait;
  const nSaved = candidates.filter((c) => savedSet.has(c.ticker)).length;

  // Sections in reading order. Inside the box: nearest trigger first. Live: by bucket inside each group, quiet names last.
  const toTrigger = (c: DeckCard) => (c.box ? c.box.top / c.price - 1 : Number.POSITIVE_INFINITY);
  const bucketRank = (c: DeckCard) => {
    const r = liveRow.get(c.ticker);
    return r ? BUCKET_ORDER.indexOf(r.status) : BUCKET_ORDER.length;
  };
  const sections = OPEN_GROUPS.map((g) => {
    let rows = candidates.map((c, i) => ({ c, i })).filter(({ c }) => groupOf(c) === g.key);
    if (filter === "saved") rows = rows.filter(({ c }) => savedSet.has(c.ticker));
    if (g.key === "inside") rows.sort((a, b) => toTrigger(a.c) - toTrigger(b.c));
    if (showLive) rows.sort((a, b) => bucketRank(a.c) - bucketRank(b.c));
    return { ...g, rows };
  }).filter((s) => {
    if (filter === "wait" && s.key === "pass") return false;
    if (filter === "pass" && s.key !== "pass") return false;
    if (s.key === "arms" && filter !== "pass" && filter !== "saved") return true; // the question the list answers, even at zero
    return s.rows.length > 0;
  });
  const passShown = passOpen || filter === "pass";

  const row = (c: DeckCard, i: number, group: OpenGroup) => {
    const r = liveRow.get(c.ticker);
    const hint = plan[c.ticker]?.hint ?? null;
    const liveDist = r && group === "inside" && r.toTriggerPct !== null && r.toTriggerPct > 0 ? `${pct(r.toTriggerPct, 1)} to trigger` : null;
    const sub = liveDist ?? hint;
    return (
      <li key={c.ticker}>
        <Link href={`/?i=${i}`} className="flex w-full items-center gap-3 px-1 py-2.5 text-left active:bg-neutral-800">
          <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-neutral-600">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className="font-semibold">{c.ticker}</span>
              {savedSet.has(c.ticker) && <span className="text-[11px] text-amber-400">★</span>}
              {c.box && group !== "arms" && group !== "inside" && <span className="text-[11px] text-neutral-500">box</span>}
            </span>
            <span className="block truncate text-[11px] text-neutral-500">
              {sub ? <><span className="text-neutral-400">{sub}</span> · </> : null}
              {c.name}
            </span>
          </span>
          {r ? (
            <span className="shrink-0 text-right">
              <span className="block text-sm tabular-nums text-neutral-200">{price(r.price)}</span>
              <span className="block text-[10px] tabular-nums text-neutral-600">close {price(c.price)}</span>
            </span>
          ) : (
            <span className="shrink-0 text-sm tabular-nums text-neutral-300">{price(c.price)}</span>
          )}
          {r && live ? (
            <LiveChip status={r.status} muted={!live.live} className="shrink-0 whitespace-nowrap" />
          ) : (
            <span className={`w-12 shrink-0 rounded-full py-0.5 text-center text-[11px] font-semibold ${verdictChip(c.verdict)}`}>
              {verdictLabel(c.verdict) ?? "—"}
            </span>
          )}
        </Link>
      </li>
    );
  };

  const chip = (f: Exclude<Filter, null>, label: string, n: number, on: string) => (
    <button
      key={f}
      onClick={() => toggleFilter(f)}
      aria-pressed={filter === f}
      className={`rounded-full px-2 py-0.5 font-semibold ${filter === f || filter === null ? on : "bg-neutral-800 text-neutral-500"}`}
    >
      {label} {n}
    </button>
  );

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {chip("wait", "Wait", nWait, verdictChip("wait"))}
        {chip("pass", "Pass", nPass, verdictChip("pass"))}
        {nSaved > 0 && chip("saved", "★", nSaved, "bg-amber-900/70 text-amber-200")}
        <span className="ml-auto flex items-center gap-2">
          {showLive && live && (
            <span className="text-neutral-500">as of {live.asOf}{live.live ? "" : " · market closed"}</span>
          )}
          {live && live.rows.length > 0 && (
            <button
              onClick={toggleLive}
              aria-pressed={liveView}
              className={`rounded-full px-2.5 py-0.5 font-semibold ${liveView ? "bg-sky-500/90 text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}
            >
              Live
            </button>
          )}
        </span>
      </div>
      {err && <p className="mt-2 text-[11px] text-sky-300/80">live status unavailable ({err}) — showing stored verdicts</p>}
      <ul className="mt-2 border-t border-neutral-800">
        {sections.map((s) => (
          <li key={s.key}>
            {s.key === "pass" ? (
              <button
                onClick={() => setPassOpen((v) => !v)}
                aria-expanded={passShown}
                className={`flex w-full items-center justify-between px-1 py-2 text-[11px] font-semibold uppercase tracking-wide active:bg-neutral-800 ${HEAD_TONE.pass}`}
              >
                <span>{s.title}</span>
                <span className="normal-case tracking-normal text-neutral-500">
                  {s.rows.length} · {passShown ? "hide" : "folded · show"}
                </span>
              </button>
            ) : (
              <div className={`flex items-center justify-between px-1 py-2 text-[11px] font-semibold uppercase tracking-wide ${HEAD_TONE[s.key]}`}>
                <span>{s.title}</span>
                <span className="normal-case tracking-normal text-neutral-500">
                  {s.rows.length} · {s.key === "arms" && s.rows.length === 0 ? "nothing closed above its box" : s.sub}
                </span>
              </div>
            )}
            {(s.key !== "pass" || passShown) && (
              <ul className="border-b border-neutral-800">{s.rows.map(({ c, i }) => row(c, i, s.key))}</ul>
            )}
          </li>
        ))}
        {sections.length === 0 && <li className="py-6 text-center text-[11px] text-neutral-600">nothing matches this filter</li>}
      </ul>
    </section>
  );
}
