import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import DrillCard from "@/components/DrillCard";
import TopNav from "@/components/TopNav";
import { CONFIG } from "@/lib/config";
import { drillScore, type DrillScore } from "@/lib/drill";
import { drillAnswers, nextDrillRow } from "@/lib/drill-db";
import { galleryWindow, type GalleryRow } from "@/lib/gallery";
import { loadBarWindows } from "@/lib/scan";
import type { Bar } from "@/lib/types";

export const metadata = { title: "Drill — Scanmana" };
export const dynamic = "force-dynamic";

/**
 * /drill (1.8.5) — Kullamägi's eye came from thousands of charts with the right
 * side covered; the gallery shows the charts that worked with the answer on them,
 * this page hides the answer first. One scored deck row at random, drawn up to its
 * scan night with name and date hidden, one call (Take / Skip), then the twenty
 * sessions after, what the app said that night, and the running record against the
 * 5-star rule and the base rate. Reads scan_history × research_outcomes × bars,
 * writes one row per call to drill_answers (keyed by Clerk user id).
 */
export default async function DrillPage() {
  const { userId } = await auth();
  let row: GalleryRow | null = null;
  let bars: Bar[] = [];
  let score: DrillScore = drillScore([]);
  let error: string | null = null;
  if (userId) {
    try {
      const [next, answers] = await Promise.all([nextDrillRow(userId), drillAnswers(userId)]);
      row = next;
      score = drillScore(answers);
      if (row) bars = (await loadBarWindows([{ ticker: row.ticker, ...galleryWindow(row.date) }])).get(row.ticker) ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 lg:max-w-3xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/drill" subtitle="Drill" />

      <p className="text-[13px] leading-relaxed text-neutral-300">
        His eye came from thousands of charts with the right side covered. This is that, on the scanner&apos;s own history: a deck card from a
        past scan night, drawn up to that night, name and date hidden. Make the call, then look. A chart counts as having run when its best
        close in the twenty sessions after was {Math.round(CONFIG.DRILL.RAN_MFE * 100)}% or more over the scan-night close. Terms in{" "}
        <Link href="/help#drill" className="text-neutral-100 underline underline-offset-4">Help</Link>.
      </p>

      {error && <div className="mt-4 rounded-xl bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</div>}

      {!userId && (
        <div className="mt-4 rounded-xl bg-neutral-900 px-3 py-3 text-[12px] leading-relaxed text-neutral-400">
          Sign in to drill: each call is kept against your account so the record builds up.
        </div>
      )}

      {userId && !error && !row && (
        <div className="mt-4 rounded-xl bg-neutral-900 px-3 py-3 text-[12px] leading-relaxed text-neutral-400">
          {score.n > 0
            ? `You have called every scored chart the store still holds (${score.n}). A new scan night joins the drill once twenty sessions have passed and the nightly outcomes job has scored it; the tickers from your last ${CONFIG.DRILL.RECENT_TICKERS} calls sit out until then.`
            : "Nothing to drill yet: a scan night joins once twenty sessions have passed and the nightly outcomes job has scored it."}
        </div>
      )}

      {userId && row && <DrillCard key={`${row.ticker}-${row.date}`} row={row} bars={bars} initialScore={score} />}

      <p className="mt-6 text-[11px] leading-relaxed text-neutral-600">
        Charts are every deck row with twenty sessions of follow-through, winners and losers alike, one at random each time; a name you
        called recently sits out so the second look is not from memory. The 5-star rule&apos;s call on the same chart is the gallery&apos;s
        filter: boxed Wait, resting under the box top. The{" "}
        <Link href="/gallery" className="text-neutral-400 underline underline-offset-4">gallery</Link> is the same history with the answers showing.
      </p>
    </main>
  );
}
