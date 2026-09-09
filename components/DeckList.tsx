"use client";

import { useEffect, useState } from "react";
import LiveChip, { LIVE_CHIP } from "@/components/LiveChip";
import { price, pct } from "@/lib/format";
import { BUCKET_ORDER, type LiveDeckBundle, type LiveWatchRow, type WatchStatus } from "@/lib/livewatch";
import type { Candidate, Verdict } from "@/lib/types";
import { VERDICTS, verdictChip, verdictLabel } from "@/lib/verdict";
import { ListIcon } from "@/components/Icons";

const LIVE_PREF = "scanmana.deckListLive";

function readPref(): boolean {
  try {
    const v = localStorage.getItem(LIVE_PREF);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export default function DeckList({
  candidates,
  current,
  saved,
  live,
  onPick,
  onClose,
}: {
  candidates: Candidate[];
  current: number;
  saved: Set<string>;
  /** Live read of the deck (home page only); null/undefined = not available. */
  live?: LiveDeckBundle | null;
  onPick: (idx: number) => void;
  onClose: () => void;
}) {
  // Lazy: this overlay only ever mounts in the browser (after a tap), so localStorage is safe to read.
  const [liveView, setLiveView] = useState(readPref);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const count = (v: Verdict) => candidates.filter((c) => c.verdict === v).length;
  const showLive = liveView && !!live && live.rows.length > 0;
  const toggleLive = () => {
    const next = !liveView;
    setLiveView(next);
    try { localStorage.setItem(LIVE_PREF, next ? "1" : "0"); } catch { /* private mode etc. */ }
  };

  const indexOf = new Map(candidates.map((c, i) => [c.ticker, i]));
  const row = (c: Candidate, i: number, r?: LiveWatchRow) => (
    <li key={c.ticker}>
      <button
        onClick={() => onPick(i)}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-neutral-800 ${i === current ? "bg-neutral-900" : ""}`}
      >
        <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-neutral-600">{i + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="font-semibold">{c.ticker}</span>
            {saved.has(c.ticker) && <span className="text-[11px] text-amber-400">★</span>}
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
      </button>
    </li>
  );

  // Live view: group by bucket in the watchlist's order; names without a quote trail at the end.
  const groups: { status: WatchStatus | null; rows: { c: Candidate; i: number; r?: LiveWatchRow }[] }[] = [];
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-2xl bg-[#0f141b] pt-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:rounded-2xl lg:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ListIcon size={20} /> Tonight&apos;s deck <span className="ml-1 text-sm font-normal text-neutral-500">{candidates.length}</span>
          </h2>
          <div className="flex items-center gap-2">
            {live && live.rows.length > 0 && (
              <button
                onClick={toggleLive}
                aria-pressed={liveView}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  liveView ? "bg-sky-500/90 text-neutral-950" : "bg-neutral-800 text-neutral-300"
                }`}
              >
                Live
              </button>
            )}
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-neutral-400 active:text-neutral-100" aria-label="close">
              ✕
            </button>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 px-4 text-[11px]">
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
          {showLive && live && (
            <span className="ml-auto text-neutral-500">as of {live.asOf}{live.live ? "" : " · market closed"}</span>
          )}
        </div>
        <ul className="mt-2 flex-1 overflow-y-auto border-t border-neutral-800">
          {showLive && live
            ? groups.map((g) => (
                <li key={g.status ?? "none"}>
                  <div className="flex items-center gap-2 bg-neutral-950/60 px-4 py-1.5 text-[11px] text-neutral-400">
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
      </div>
    </div>
  );
}
