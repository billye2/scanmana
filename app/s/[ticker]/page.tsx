import Link from "next/link";
import Deck from "@/components/Deck";
import { getSql } from "@/lib/db";
import { latestScan, loadBars } from "@/lib/scan";
import { analyzeCandidate } from "@/lib/analysis";
import type { Analysis } from "@/lib/types";
import { buildCandidate } from "@/lib/screen";
import { liveBundle } from "@/lib/intraday";
import MarketBar from "@/components/MarketBar";
import SymbolLookup from "@/components/SymbolLookup";
import type { Bar, Candidate } from "@/lib/types";
import { CONFIG } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function SymbolPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ live?: string }>;
}) {
  const ticker = (await params).ticker.toUpperCase();
  const live = (await searchParams).live === "1";
  let candidate: Candidate | null = null;
  let scanDate = ""; // "" → Analysis modal falls back to the latest stored read for this ticker
  let inDeck = false;
  let savedTickers: string[] = [];
  let error: string | null = null;
  let freshAnalysis: Analysis | null = null; // computed now for non-deck symbols; nothing stored to fetch
  let liveNote: string | null = null;
  let liveMarket: Awaited<ReturnType<typeof liveBundle>>["market"];

  try {
    const sql = getSql();
    const scan = await latestScan();
    const watch = (await sql`SELECT ticker FROM watchlist`) as { ticker: string }[];
    savedTickers = watch.map((r) => r.ticker);
    const fromDeck = live ? null : (scan?.candidates.find((c) => c.ticker === ticker) ?? null);
    let b: Bar[] = [];
    if (live) {
      // Live mode: provisional today-bar from Finnhub + market filter recomputed
      // from live index quotes. Falls back to EOD with a note on any failure.
      try {
        const bundle = await liveBundle(ticker);
        b = bundle.bars;
        liveMarket = bundle.market;
        liveNote = bundle.provisional
          ? `intraday · as of ${bundle.asOf} · today's bar is provisional; volume assumed at the 20-day average`
          : `intraday · as of ${bundle.asOf} · stored history already covers today`;
      } catch (err) {
        liveNote = `live quotes unavailable (${err instanceof Error ? err.message : "error"}) — showing end-of-day data`;
      }
    }
    if (b.length === 0) {
      const bars = await loadBars([ticker]);
      b = bars.get(ticker) ?? [];
    }
    if (fromDeck) {
      candidate = fromDeck;
      scanDate = scan!.date;
      inDeck = true;
    } else {
      const names = (await sql`SELECT name FROM tickers WHERE ticker = ${ticker}`) as { name: string }[];
      candidate = buildCandidate(ticker, names[0]?.name ?? ticker, b);
      if (candidate) {
        freshAnalysis = analyzeCandidate(candidate, liveMarket ?? scan?.market);
        candidate.verdict = freshAnalysis.overall;
      }
      if (!candidate)
        error =
          b.length === 0
            ? `No price history stored for ${ticker}. The bar store covers US-listed stocks and ETFs from the nightly grouped-daily feed.`
            : `Not enough history for ${ticker} (${b.length} bars; the screen needs ${CONFIG.MIN_BARS}).`;
    }
  } catch {
    error = "Database not configured.";
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-none lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[calc(env(safe-area-inset-bottom)+80px)]">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-lg leading-tight font-bold tracking-tight">
          <span className="text-emerald-400">◎</span> {ticker}
          <span className="block text-xs font-normal text-neutral-500">
            {inDeck ? `in tonight's deck · ${scanDate}` : "not in tonight's deck — built from stored bars"}
          </span>
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <span id="deck-camera-slot" className="flex items-center empty:hidden" />
          <Link
            href={live ? `/s/${ticker}` : `/s/${ticker}?live=1`}
            className={live ? "font-semibold text-emerald-400" : "text-neutral-400 active:text-neutral-200"}
          >
            {live ? "● Live" : "Live"}
          </Link>
          <Link href="/watchlist" className="text-neutral-400 active:text-neutral-200">
            ★
          </Link>
          <Link href="/" className="text-neutral-400 active:text-neutral-200">
            Deck
          </Link>
        </div>
      </header>

      <div className="mb-3">
        <SymbolLookup placeholder="Look up another symbol…" />
      </div>
      {liveNote && <p className="mb-2 text-[11px] text-sky-300/80">{liveNote}</p>}
      {live && liveMarket && <MarketBar market={liveMarket} />}
      {candidate ? (
        <Deck candidates={[candidate]} alerts={[]} savedTickers={savedTickers} date={scanDate} analysisOverride={freshAnalysis ?? undefined} />
      ) : (
        <p className="mt-16 text-center text-sm text-neutral-500">{error}</p>
      )}
    </main>
  );
}
