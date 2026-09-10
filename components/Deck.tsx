"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AnalysisModal from "@/components/AnalysisModal";
import Chart from "@/components/Chart";
import LiveChip from "@/components/LiveChip";
import ScreenFit from "@/components/ScreenFit";
import { useLive } from "@/components/useLive";
import { explainScreen } from "@/lib/screen";
import { explainVcp } from "@/lib/minervini";
import { BellIcon, BriefcaseIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, ListIcon, StarIcon } from "@/components/Icons";
import { money, pct, price } from "@/lib/format";
import type { LiveDeckBundle } from "@/lib/livewatch";
import type { Analysis, Bar, DeckCard, WatchlistAlert } from "@/lib/types";
import { verdictChip, verdictLabel } from "@/lib/verdict";
import { APP_VERSION } from "@/lib/version";

// Bottom bar items: one column each, the same icon size and colours as the top nav.
const BAR_ITEM = "flex items-center justify-center py-2.5 text-neutral-400 active:text-neutral-100 disabled:opacity-30";

function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "green" | "amber" | "blue" }) {
  const tones = {
    neutral: "bg-neutral-800 text-neutral-300",
    green: "bg-emerald-900/60 text-emerald-300",
    amber: "bg-amber-900/60 text-amber-300",
    blue: "bg-sky-900/60 text-sky-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}>
      {label}
    </span>
  );
}

export default function Deck({
  candidates,
  alerts,
  savedTickers,
  takenTickers = [],
  date,
  analysisOverride,
  live = false,
  initialIndex = 0,
}: {
  candidates: DeckCard[];
  alerts: WatchlistAlert[];
  savedTickers: string[];
  /** Tickers with a live manual paper order or open manual position (the Take control shows "Taken"). */
  takenTickers?: string[];
  date: string;
  /** Symbol page, non-deck ticker: analysis computed at render time — the modal shows this instead of fetching (nothing is stored). */
  analysisOverride?: Analysis;
  /** Home deck only: poll /api/scan/live and show each card's live read (chip + live distance to trigger). */
  live?: boolean;
  /** Card to open first (the /deck page links back with ?i=). */
  initialIndex?: number;
}) {
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, candidates.length - 1)));
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set(savedTickers));
  const [taken, setTaken] = useState<Set<string>>(new Set(takenTickers));
  const [takeStop, setTakeStop] = useState<string | null>(null); // pivot-only card: the typed stop, while the input is open
  const [takeError, setTakeError] = useState<string | null>(null);
  // Bars per card. The page embeds bars for the first card(s) only; the rest arrive
  // from /api/scan/bars as you page, the neighbours fetched ahead so › never waits.
  const [barsByTicker, setBarsByTicker] = useState<Record<string, Bar[]>>(() =>
    Object.fromEntries(candidates.filter((c) => c.bars).map((c) => [c.ticker, c.bars!])),
  );
  const [barsErrors, setBarsErrors] = useState<Record<string, string>>({});
  const barsInflight = useRef(new Set<string>());
  const loadBars = useCallback(
    (ticker: string) => {
      if (barsByTicker[ticker] || barsInflight.current.has(ticker)) return;
      barsInflight.current.add(ticker);
      const q = new URLSearchParams({ ticker });
      if (date) q.set("date", date);
      fetch(`/api/scan/bars?${q}`)
        .then(async (r) => (r.ok ? (r.json() as Promise<Bar[]>) : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? r.statusText))))
        .then((bars) => {
          setBarsByTicker((prev) => ({ ...prev, [ticker]: bars }));
          setBarsErrors(({ [ticker]: _gone, ...rest }) => (void _gone, rest));
        })
        .catch((e) => setBarsErrors((prev) => ({ ...prev, [ticker]: e instanceof Error ? e.message : String(e) })))
        .finally(() => barsInflight.current.delete(ticker));
    },
    [date, barsByTicker],
  );
  useEffect(() => {
    const n = candidates.length;
    if (n === 0) return;
    for (const d of [0, 1, -1]) loadBars(candidates[(idx + d + n) % n].ticker);
  }, [idx, candidates, loadBars]);
  // Live chip + live trigger distance on the card. Budgeted server-side (CONFIG.LIVE); /deck polls the same route.
  const { data: liveDeck } = useLive<LiveDeckBundle>(live ? "/api/scan/live" : null);

  const go = useCallback(
    (delta: number) => {
      // Wrap around: › on the last card returns to the first, ‹ on the first jumps to the last.
      setIdx((i) => (i + delta + candidates.length) % candidates.length);
    },
    [candidates.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // typing in the lookup field
      if (e.key === "ArrowRight" || e.key === "j") go(1);
      if (e.key === "ArrowLeft" || e.key === "k") go(-1);
      if (e.key === " ") {
        e.preventDefault(); // space would scroll the page
        const cur = candidates[idx];
        if (cur) window.open(`https://www.google.com/search?q=${encodeURIComponent(`${cur.ticker} stock`)}`, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, candidates, idx]);

  if (candidates.length === 0) {
    return (
      <p className="mt-16 text-center text-sm text-neutral-500">
        No setups passed the screen. Quiet tape — check back after the next scan.
      </p>
    );
  }

  const c = candidates[idx];
  const isSaved = saved.has(c.ticker);
  const liveRow = liveDeck?.rows.find((r) => r.ticker === c.ticker) ?? null;
  const bars = barsByTicker[c.ticker] ?? null;
  // Pure + cheap on the card's bars; deck names pass every screen rule
  // by construction, so on the deck this reads as the numbers behind the ✓s.
  const checks = bars ? explainScreen(c, bars) : [];
  const vcpChecks = bars ? explainVcp(bars) : [];

  async function toggleWatch() {
    const next = new Set(saved);
    if (isSaved) {
      next.delete(c.ticker);
      setSaved(next);
      await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: c.ticker }),
      });
    } else {
      next.add(c.ticker);
      setSaved(next);
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: c.ticker,
          boxTop: c.box?.top ?? c.pivot ?? null,
          boxBottom: c.box?.bottom ?? null,
        }),
      });
      if (!res.ok) {
        // e.g. the communal watchlist cap — revert the star so the UI tells the truth
        setSaved((cur) => {
          const undo = new Set(cur);
          undo.delete(c.ticker);
          return undo;
        });
      }
    }
  }

  /**
   * Take the card into the manual paper book: the same buy-stop as ☆ Watch (box
   * top, else the bare pivot) with the box bottom as the stop. A pivot-only card
   * has no stop line, so the first tap opens an input for one.
   */
  async function take() {
    const trigger = c.box?.top ?? c.pivot ?? null;
    if (trigger === null) return;
    let stop: number | null = c.box?.bottom ?? null;
    if (stop === null) {
      if (takeStop === null) {
        setTakeStop("");
        return;
      }
      stop = Number(takeStop);
      if (!(stop > 0 && stop < trigger)) {
        setTakeError("stop must be a price below the trigger");
        return;
      }
    }
    setTakeError(null);
    const res = await fetch("/api/paper/take", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: c.ticker, stop }),
    });
    if (res.ok) {
      setTaken((cur) => new Set(cur).add(c.ticker));
      setTakeStop(null);
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setTakeError(j.error ?? `take failed (${res.status})`);
    }
  }
  const isTaken = taken.has(c.ticker);
  const takeTrigger = c.box?.top ?? c.pivot ?? null;
  const canTake = takeTrigger !== null;
  // Already above the trigger: a buy-stop would sit under the market, so the take is a market buy at the next open.
  const takeAtOpen = takeTrigger !== null && c.price > takeTrigger;

  // Distance to the trigger from the live price when we have one, else from the stored close.
  const toTrigger = c.box ? (c.box.top / (liveRow?.price ?? c.price) - 1) : null;

  // target=_blank by choice: Google's COOP header wipes a named tab's name, so single-tab
  // reuse is impossible with google.com (works with Bing/DDG). The iOS PWA shows externals in
  // one in-app sheet regardless. Decided 2026-09-01: keep Google, accept desktop new tabs.
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`${c.ticker} stock`)}`;

  // No swipe navigation: horizontal touch gestures misfired on phones (chart pans, scroll
  // jitter), so the ‹ › buttons, the list and the keyboard are the only ways between cards (removed 2026-09-08).
  return (
    <div className="flex flex-1 flex-col">
      {alerts.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {alerts.map((a) => {
            // In tonight's deck → jump to its card; otherwise → the symbol lookup page (same card, computed on the fly).
            const pill =
              "inline-flex items-center gap-1 rounded-full bg-emerald-900/70 px-3 py-1 text-xs font-semibold text-emerald-200 active:bg-emerald-800";
            const label = (
              <>
                <BellIcon size={13} /> {a.ticker} broke its box ({price(a.boxTop)})
              </>
            );
            const i = candidates.findIndex((x) => x.ticker === a.ticker);
            return i >= 0 ? (
              <button key={a.ticker} type="button" onClick={() => setIdx(i)} className={pill} aria-label={`Show ${a.ticker} card`}>
                {label}
              </button>
            ) : (
              <Link key={a.ticker} href={`/s/${encodeURIComponent(a.ticker)}`} className={pill} aria-label={`Look up ${a.ticker}`}>
                {label}
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 overflow-hidden">
            <h2 className="text-2xl font-bold tracking-tight">{c.ticker}</h2>
            <span className="truncate text-xs text-neutral-500">{c.name}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <button
              onClick={() => setShowAnalysis(true)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium active:opacity-80 ${verdictChip(c.verdict)}`}
            >
              Analysis{verdictLabel(c.verdict) ? ` (${verdictLabel(c.verdict)})` : ""}
            </button>
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-300 active:bg-neutral-700"
            >
              Google ↗
            </a>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">{price(liveRow?.price ?? c.price)}</div>
          <div className="text-[11px] text-neutral-500">
            {liveRow && <>close {price(c.price)} · </>}
            {money(c.dollarVol)}/day
          </div>
        </div>
      </div>
      {showAnalysis && <AnalysisModal ticker={c.ticker} date={date} override={analysisOverride} onClose={() => setShowAnalysis(false)} />}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {liveRow && liveDeck && (
          <LiveChip status={liveRow.status} muted={!liveDeck.live} />
        )}
        <Badge label={`1M ${pct(c.ret1m)}`} tone={c.ret1m >= 0.25 ? "green" : "neutral"} />
        <Badge label={`3M ${pct(c.ret3m)}`} tone={c.ret3m >= 0.5 ? "green" : "neutral"} />
        <Badge label={`6M ${pct(c.ret6m)}`} tone={c.ret6m >= 1 ? "green" : "neutral"} />
        <Badge label={`ADR ${c.adrPct.toFixed(1)}%`} tone="blue" />
        <Badge label={`tight ${c.tightness.toFixed(2)}`} tone="amber" />
        {c.ep && <Badge label={`EP ${pct(c.ep.gapPct)} · ${c.ep.volMult.toFixed(0)}× vol`} tone="green" />}
      </div>

      <div className="relative mt-3 min-h-[300px] flex-1 lg:min-h-[480px]">
        {bars ? (
          <Chart key={c.ticker} bars={bars} box={c.box} pivot={c.pivot} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-600">
            {barsErrors[c.ticker] ? `Chart unavailable — ${barsErrors[c.ticker]}` : "Loading chart…"}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-400">
        {c.box ? (
          <span>
            trigger <span className="font-semibold text-amber-400">{price(c.box.top)}</span>
            {toTrigger !== null && <span className="text-neutral-500"> ({pct(toTrigger, 1)}{liveRow ? " live" : ""})</span>}
            {" · "}stop <span className="font-semibold text-amber-400/80">{price(c.box.bottom)}</span>
          </span>
        ) : c.pivot !== null ? (
          <span>
            pivot <span className="font-semibold text-sky-400">{price(c.pivot)}</span>
            <span className="text-neutral-600"> · no box, no stop line</span>
          </span>
        ) : (
          <span className="text-neutral-600">no box — already extended or basing loosely</span>
        )}
        <span className="flex shrink-0 items-center gap-2">
          {canTake && (
            <>
              {takeStop !== null && !isTaken && (
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="stop"
                  value={takeStop}
                  onChange={(e) => setTakeStop(e.target.value)}
                  className="w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                  aria-label="Stop price for the paper order"
                />
              )}
              <button
                onClick={take}
                disabled={isTaken}
                aria-pressed={isTaken}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${isTaken ? "bg-neutral-800 text-neutral-500" : "bg-emerald-700 text-white active:bg-emerald-600"}`}
                aria-label={
                  isTaken
                    ? "Taken into the manual paper book"
                    : takeAtOpen
                      ? "Take — buy at the next open in the manual paper book (price is already above the trigger)"
                      : "Take — arm this buy-stop in the manual paper book"
                }
              >
                {isTaken ? "Taken" : takeAtOpen ? "Take at open" : "Take"}
              </button>
            </>
          )}
          <span className="text-neutral-600">
            {idx + 1}/{candidates.length}
          </span>
        </span>
      </div>
      {takeError && <p className="mt-1 text-xs text-red-300">{takeError}</p>}

      {/* Permanent bottom nav bar (fixed; pages pad their bottom so nothing hides under it).
          Same line icons as the top nav, icon-only in equal columns, because the
          old text buttons (‹ › ☆ ★ ↗) rendered in mismatched fallback fonts on iPhone. */}
      <nav
        aria-label="Deck navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-[#0a0e14]/95 pt-1 pb-[max(env(safe-area-inset-bottom),6px)] backdrop-blur"
      >
        <div className={`mx-auto grid w-full max-w-xl ${live ? "grid-cols-6" : "grid-cols-5"}`}>
          <button onClick={() => go(-1)} disabled={candidates.length < 2} className={BAR_ITEM} aria-label="Previous card">
            <ChevronLeftIcon size={25} />
          </button>
          <button
            onClick={toggleWatch}
            aria-pressed={isSaved}
            aria-label={isSaved ? "Watching — tap to remove from the watchlist" : "Watch — add to the watchlist"}
            className={`${BAR_ITEM} ${isSaved ? "text-amber-400" : ""}`}
          >
            <StarIcon size={25} fill={isSaved ? "currentColor" : "none"} />
          </button>
          {live && (
            <Link href="/deck" className={BAR_ITEM} aria-label="Tonight's deck — the whole list, grouped live">
              <ListIcon size={25} />
            </Link>
          )}
          <Link href="/paper" className={BAR_ITEM} aria-label="Paper trading book">
            <BriefcaseIcon size={25} />
          </Link>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={BAR_ITEM} aria-label="Google this symbol (opens a new tab)">
            <ExternalLinkIcon size={25} />
          </a>
          <button onClick={() => go(1)} disabled={candidates.length < 2} className={BAR_ITEM} aria-label="Next card">
            <ChevronRightIcon size={25} />
          </button>
        </div>
      </nav>

      {bars && <ScreenFit checks={checks} vcp={vcpChecks} inDeck={date !== ""} />}
    </div>
  );
}
