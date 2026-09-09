"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import AnalysisModal from "@/components/AnalysisModal";
import Chart from "@/components/Chart";
import DeckList from "@/components/DeckList";
import LiveChip from "@/components/LiveChip";
import ScreenFit from "@/components/ScreenFit";
import { useLive } from "@/components/useLive";
import { explainScreen } from "@/lib/screen";
import { explainVcp } from "@/lib/minervini";
import { BellIcon, CameraIcon, ListIcon } from "@/components/Icons";
import { money, pct, price } from "@/lib/format";
import type { LiveDeckBundle } from "@/lib/livewatch";
import type { Analysis, Candidate, WatchlistAlert } from "@/lib/types";
import { verdictChip, verdictLabel } from "@/lib/verdict";
import { APP_VERSION } from "@/lib/version";

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
  date,
  analysisOverride,
  live = false,
}: {
  candidates: Candidate[];
  alerts: WatchlistAlert[];
  savedTickers: string[];
  date: string;
  /** Symbol page, non-deck ticker: analysis computed at render time — the modal shows this instead of fetching (nothing is stored). */
  analysisOverride?: Analysis;
  /** Home deck only: poll /api/scan/live and show each card's live read (chip + live distance to trigger). */
  live?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showList, setShowList] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set(savedTickers));
  const shotRef = useRef<(() => HTMLCanvasElement) | null>(null);
  const [snapping, setSnapping] = useState(false);
  // One poll serves the card chip and the list overlay. Budgeted server-side (CONFIG.LIVE).
  const { data: liveDeck } = useLive<LiveDeckBundle>(live ? "/api/scan/live" : null);

  const go = useCallback(
    (delta: number) => {
      // Wrap around: › on the last card returns to the first, ‹ on the first jumps to the last.
      setIdx((i) => (i + delta + candidates.length) % candidates.length);
    },
    [candidates.length],
  );

  // Header slots (home + symbol page) — the headers are server components, the deck state lives here.
  const listSlot = useSyncExternalStore(
    () => () => {},
    () => document.getElementById("deck-list-slot"),
    () => null,
  );
  const cameraSlot = useSyncExternalStore(
    () => () => {},
    () => document.getElementById("deck-camera-slot"),
    () => null,
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
  // Pure + cheap on the card's embedded bars; deck names pass every screen rule
  // by construction, so on the deck this reads as the numbers behind the ✓s.
  const checks = explainScreen(c, c.bars);
  const vcpChecks = explainVcp(c.bars);

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

  // Distance to the trigger from the live price when we have one, else from the stored close.
  const toTrigger = c.box ? (c.box.top / (liveRow?.price ?? c.price) - 1) : null;

  /**
   * Snapshot the WHOLE page — header, card, chart, Scan fit / VCP blocks — as one
   * tall PNG and hand it to the native share sheet (iOS: includes Print); desktop
   * falls back to a download. If DOM serialization fails, falls back to a
   * chart-only capture composed with a header band.
   */
  async function snapshot() {
    if (snapping) return;
    setSnapping(true);
    try {
      const main = document.querySelector("main");
      if (main) {
        const { toCanvas } = await import("html-to-image");
        const opts = {
          backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0a",
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2), // iOS canvas memory cap
          filter: (node: HTMLElement) => node.tagName !== "NEXTJS-PORTAL", // dev overlay
        };
        // iOS Safari often returns a blank image on the first serialization — warm up once.
        if (/iP(hone|ad|od)/.test(navigator.userAgent)) await toCanvas(main, opts);
        const page = await toCanvas(main, opts);
        // iOS sometimes rasterizes before the chart's big pane canvas decodes, leaving it
        // blank in the clone — paint the chart's own screenshot over its exact spot.
        const shot = shotRef.current?.();
        const chartEl = main.querySelector(".tv-lightweight-charts");
        if (shot && chartEl) {
          const mr = main.getBoundingClientRect();
          const cr = chartEl.getBoundingClientRect();
          const scale = page.width / mr.width;
          page
            .getContext("2d")!
            .drawImage(shot, (cr.left - mr.left) * scale, (cr.top - mr.top) * scale, cr.width * scale, cr.height * scale);
        }
        const blob = await new Promise<Blob | null>((res) => page.toBlob(res, "image/png"));
        if (blob) {
          await deliver(blob, `${c.ticker}-${date || new Date().toISOString().slice(0, 10)}.png`);
          return;
        }
      }
      await chartOnlySnapshot(); // fallback
    } catch {
      await chartOnlySnapshot().catch(() => {});
    } finally {
      setSnapping(false);
    }
  }

  /** Share via the native sheet when possible, else download. */
  async function deliver(blob: Blob, name: string) {
    const file = new File([blob], name, { type: "image/png" });
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${c.ticker} — Scanmana` });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // user closed the sheet
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Fallback: chart canvas only, with a composed header band. */
  async function chartOnlySnapshot() {
    const shot = shotRef.current?.();
    if (!shot) return;
    // Scale from the screenshot's own width — takeScreenshot() may return CSS or device pixels.
    const u = shot.width / 400;
    const header = Math.round(56 * u);
    const out = document.createElement("canvas");
    out.width = shot.width;
    out.height = shot.height + header;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#0a0f14";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(shot, 0, header);
    const pad = 12 * u;
    ctx.fillStyle = "#f5f5f5";
    ctx.font = `bold ${17 * u}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(c.ticker, pad, 22 * u);
    ctx.textAlign = "right";
    ctx.fillText(price(c.price), out.width - pad, 22 * u);
    ctx.textAlign = "left";
    ctx.fillStyle = "#9ca3af";
    ctx.font = `${11 * u}px -apple-system, system-ui, sans-serif`;
    const verdict = verdictLabel(c.verdict);
    const plan = c.box ? `trigger ${price(c.box.top)} · stop ${price(c.box.bottom)}` : "no box";
    const stamp = `Scanmana v${APP_VERSION}${date ? ` · ${date}` : ""}`;
    const stampW = ctx.measureText(stamp).width;
    // maxWidth clamps the info line so it never runs under the right-aligned stamp
    ctx.fillText(`${verdict ? `${verdict} · ` : ""}${plan}`, pad, 42 * u, out.width - 2 * pad - stampW - 8 * u);
    ctx.textAlign = "right";
    ctx.fillStyle = "#4b5563";
    ctx.fillText(stamp, out.width - pad, 42 * u);
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
    if (blob) await deliver(blob, `${c.ticker}-${date || "chart"}.png`);
  }
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
        <Chart key={c.ticker} bars={c.bars} box={c.box} pivot={c.pivot} shotRef={shotRef} />
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-neutral-400">
        {c.box ? (
          <span>
            trigger <span className="font-semibold text-amber-400">{price(c.box.top)}</span>
            {toTrigger !== null && <span className="text-neutral-500"> ({pct(toTrigger, 1)}{liveRow ? " live" : ""})</span>}
            {" · "}stop <span className="font-semibold text-amber-400/80">{price(c.box.bottom)}</span>
          </span>
        ) : (
          <span className="text-neutral-600">no box — already extended or basing loosely</span>
        )}
        <span className="text-neutral-600">
          {idx + 1}/{candidates.length}
        </span>
      </div>
      {cameraSlot &&
        createPortal(
          <button
            onClick={snapshot}
            disabled={snapping}
            aria-label="Snapshot — share or print this page"
            className="flex text-neutral-400 active:text-neutral-200 disabled:opacity-40"
          >
            <CameraIcon size={25} />
          </button>,
          cameraSlot,
        )}
      {listSlot &&
        createPortal(
          <button
            onClick={() => setShowList(true)}
            className="flex text-neutral-400 active:text-neutral-200"
            aria-label="List all setups"
          >
            <ListIcon size={25} />
          </button>,
          listSlot,
        )}
      {showList && (
        <DeckList
          candidates={candidates}
          current={idx}
          saved={saved}
          live={liveDeck}
          onPick={(i) => {
            setIdx(i);
            setShowList(false);
          }}
          onClose={() => setShowList(false)}
        />
      )}

      {/* Permanent bottom nav bar (fixed; pages pad their bottom so nothing hides under it). */}
      <nav
        aria-label="Deck navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-[#0a0e14]/95 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] backdrop-blur"
      >
      <div className={`mx-auto grid w-full max-w-xl gap-2 ${live ? "grid-cols-[1fr_1.7fr_1.4fr_1.4fr_1fr]" : "grid-cols-[1fr_2fr_1.4fr_1fr]"}`}>
        <button
          onClick={() => go(-1)}
          disabled={candidates.length < 2}
          className="rounded-xl bg-neutral-800 py-3 text-lg font-semibold text-neutral-300 active:bg-neutral-700 disabled:opacity-30"
          aria-label="previous"
        >
          ‹
        </button>
        <button
          onClick={toggleWatch}
          className={`rounded-xl py-3 text-sm font-semibold active:opacity-80 ${
            isSaved ? "bg-amber-500/90 text-neutral-950" : "bg-neutral-800 text-neutral-200"
          }`}
        >
          {isSaved ? "★ Watching" : "☆ Watch"}
        </button>
        {live && (
          <button
            onClick={() => setShowList(true)}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-neutral-800 py-3 text-sm font-semibold text-neutral-200 active:bg-neutral-700"
            aria-label="Tonight's deck — list with live grouping"
          >
            <ListIcon size={16} /> Deck
          </button>
        )}
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-xl bg-neutral-800 py-3 text-sm font-semibold text-neutral-200 active:bg-neutral-700"
        >
          Google ↗
        </a>
        <button
          onClick={() => go(1)}
          disabled={candidates.length < 2}
          className="rounded-xl bg-neutral-800 py-3 text-lg font-semibold text-neutral-300 active:bg-neutral-700 disabled:opacity-30"
          aria-label="next"
        >
          ›
        </button>
      </div>
      </nav>

      <ScreenFit checks={checks} vcp={vcpChecks} inDeck={date !== ""} />
    </div>
  );
}
