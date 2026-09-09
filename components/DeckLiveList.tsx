"use client";

import { useState } from "react";
import Link from "next/link";
import LiveChip, { LIVE_CHIP } from "@/components/LiveChip";
import { useLive } from "@/components/useLive";
import { price, pct } from "@/lib/format";
import { BUCKET_ORDER, type LiveDeckBundle, type LiveWatchRow, type WatchStatus } from "@/lib/livewatch";
import type { DeckCard, Verdict } from "@/lib/types";
import { VERDICTS, verdictChip, verdictLabel } from "@/lib/verdict";

const LIVE_PREF = "scanmana.deckListLive";

function readPref(): boolean {
  try {
    const v = localStorage.getItem(LIVE_PREF);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

/**
 * Tonight's deck as one page: every card with its Wait/Pass, and — while quotes
 * are available — grouped live by what price is doing (breaking / failed /
 * stopped / approaching / quiet). Tap a row to open that card on the home deck.
 */
export default function DeckLiveList({ candidates, saved }: { candidates: DeckCard[]; saved: string[] }) {
  const { data: live, err } = useLive<LiveDeckBundle>("/api/scan/live");
  const [liveView, setLiveView] = useState(readPref);
  const savedSet = new Set(saved);

  const count = (v: Verdict) => candidates.filter((c) => c.verdict === v).length;
  const showLive = liveView && !!live && live.rows.length > 0;
  const toggleLive = () => {
    const next = !liveView;
    setLiveView(next);
    try { localStorage.setItem(LIVE_PREF, next ? "1" : "0"); } catch { /* private mode etc. */ }
  };

  const indexOf = new Map(candidates.map((c, i) => [c.ticker, i]));
  const row = (c: DeckCard, i: number, r?: LiveWatchRow) => (
    <li key={c.ticker}>
      <Link href={`/?i=${i}`} className="flex w-full items-center gap-3 px-1 py-2.5 text-left active:bg-neutral-800">
        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-neutral-600">{i + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="font-semibold">{c.ticker}</span>
            {savedSet.has(c.ticker) && <span className="text-[11px] text-amber-400">★</span>}
            {c.box && <span className="text-[11px] text-neutral-500">box</span>}
          </span>
          <span className="block truncate text-[11px] text-neutral-500">
            {r && r.toTriggerPct !== null && r.toTriggerPct > 0 ? <>{pct(r.toTriggerPct, 1)} to trigger · </> : null}
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
        <span className={`w-12 shrink-0 rounded-full py-0.5 text-center text-[11px] font-semibold ${verdictChip(c.verdict)}`}>
          {verdictLabel(c.verdict) ?? "—"}
        </span>
      </Link>
    </li>
  );

  // Live view: group by bucket in the watchlist's order; names without a quote trail at the end.
  const groups: { status: WatchStatus | null; rows: { c: DeckCard; i: number; r?: LiveWatchRow }[] }[] = [];
  if (showLive && live) {
    const seen = new Set<string>();
    for (const status of BUCKET_ORDER) {
      const rows = live.rows
        .filter((r) => r.status === status && indexOf.has(r.ticker))
        .map((r) => {
          seen.add(r.ticker);
          const i = indexOf.get(r.ticker)!;
          return { c: candidates[i], i, r };
        });
      if (rows.length > 0) groups.push({ status, rows });
    }
    const missing = candidates.map((c, i) => ({ c, i })).filter(({ c }) => !seen.has(c.ticker));
    if (missing.length > 0) groups.push({ status: null, rows: missing });
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {showLive && live
          ? groups.map((g) =>
              g.status ? (
                <span key={g.status} className={`rounded-full px-2 py-0.5 font-semibold ${LIVE_CHIP[g.status][1]} ${live.live ? "" : "opacity-60"}`}>
                  {g.rows.length} {LIVE_CHIP[g.status][0]}
                </span>
              ) : null,
            )
          : VERDICTS.map((v) => (
              <span key={v} className={`rounded-full px-2 py-0.5 font-semibold ${verdictChip(v)}`}>
                {count(v)} {verdictLabel(v)}
              </span>
            ))}
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
        {showLive && live
          ? groups.map((g) => (
              <li key={g.status ?? "none"}>
                <div className="flex items-center gap-2 bg-neutral-950/60 px-1 py-1.5 text-[11px] text-neutral-400">
                  {g.status ? (
                    <>
                      <LiveChip status={g.status} muted={!live.live} />
                      <span>{g.rows.length}</span>
                    </>
                  ) : (
                    <span>no live quote · {g.rows.length}</span>
                  )}
                </div>
                <ul>{g.rows.map(({ c, i, r }) => row(c, i, r))}</ul>
              </li>
            ))
          : candidates.map((c, i) => row(c, i))}
      </ul>
    </section>
  );
}
