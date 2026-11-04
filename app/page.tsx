import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import Link from "next/link";
import { NAV_COOKIE, bottomBarLinks, parseNav } from "@/lib/nav";
import Deck from "@/components/Deck";
import MarketBar from "@/components/MarketBar";
import PushSetup from "@/components/PushSetup";
import TopNav from "@/components/TopNav";
import { getSql } from "@/lib/db";
import MorningLine from "@/components/MorningLine";
import { morningBrief, type MorningBrief } from "@/lib/paper-engine";
import { manualTakenTickers, morningBook } from "@/lib/paper-db";
import { latestBreadth } from "@/lib/research";
import { latestScanSlim } from "@/lib/scan";
import { tapeMultiplier } from "@/lib/tape";
import type { SlimScanPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ i?: string }> }) {
  const initialIndex = Number((await searchParams).i ?? 0) || 0;
  let payload: SlimScanPayload | null = null;
  let savedTickers: string[] = [];
  let takenTickers: string[] = [];
  let breadth: Awaited<ReturnType<typeof latestBreadth>> = null;
  let brief: MorningBrief | null = null;
  let dbError = false;
  try {
    payload = await latestScanSlim({ indices: [initialIndex - 1, initialIndex, initialIndex + 1] });
    const sql = getSql();
    const rows = (await sql`SELECT ticker FROM watchlist`) as { ticker: string }[];
    savedTickers = rows.map((r) => r.ticker);
    const { userId } = await auth();
    if (userId) takenTickers = await manualTakenTickers(userId).catch(() => []);
    breadth = await latestBreadth();
    if (userId && payload) {
      // Tomorrow morning's paper actions, from the book's rows (no bars). Its own catch: the deck must render without it.
      const tape = tapeMultiplier(payload.market ? payload.market.verdict === "bullish" : null, breadth?.today.pctAbove20 ?? null);
      brief = await morningBook(userId)
        .then((mb) => morningBrief(mb.orders, mb.positions, tape.label))
        .catch(() => null);
    }
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-none lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[calc(env(safe-area-inset-bottom)+80px)]">
      <TopNav subtitle={payload?.date} />

      {dbError ? (
        <p className="mt-16 text-center text-sm text-neutral-500">
          Database not configured yet — set <code>COIL_DATABASE_URL</code> and run the migration.
        </p>
      ) : !payload ? (
        <p className="mt-16 text-center text-sm text-neutral-500">
          No scan yet — tap <span className="text-neutral-300">↻ Run scan for previous day</span> on the{" "}
          <Link href="/help" className="text-neutral-300 underline underline-offset-4">Help</Link> page. (Needs the backfill first.)
        </p>
      ) : (
        <>
          <MarketBar market={payload.market} breadth={breadth} />
          {brief && <MorningLine brief={brief} href="/paper" className="mb-3" />}
          <Deck
            candidates={payload.candidates}
            alerts={payload.watchlistAlerts}
            savedTickers={savedTickers}
            takenTickers={takenTickers}
            date={payload.date}
            live
            initialIndex={initialIndex}
            tape={tapeMultiplier(payload.market ? payload.market.verdict === "bullish" : null, breadth?.today.pctAbove20 ?? null)}
            barLinks={bottomBarLinks(parseNav((await cookies()).get(NAV_COOKIE)?.value))}
          />
        </>
      )}

      {/* Below the deck on purpose — the top of the screen belongs to the cards. The manual rescan lives on /help. */}
      <div className="mt-1 mb-1 flex flex-col gap-2">
        <PushSetup />
      </div>
    </main>
  );
}
