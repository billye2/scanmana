import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import Deck from "@/components/Deck";
import MarketBar from "@/components/MarketBar";
import PushSetup from "@/components/PushSetup";
import TopNav from "@/components/TopNav";
import { getSql } from "@/lib/db";
import { manualTakenTickers } from "@/lib/paper-db";
import { latestScan, slimDeck } from "@/lib/scan";
import type { ScanPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ i?: string }> }) {
  const initialIndex = Number((await searchParams).i ?? 0) || 0;
  let payload: ScanPayload | null = null;
  let savedTickers: string[] = [];
  let takenTickers: string[] = [];
  let dbError = false;
  try {
    payload = await latestScan();
    const sql = getSql();
    const rows = (await sql`SELECT ticker FROM watchlist`) as { ticker: string }[];
    savedTickers = rows.map((r) => r.ticker);
    const { userId } = await auth();
    if (userId) takenTickers = await manualTakenTickers(userId).catch(() => []);
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
          <MarketBar market={payload.market} />
          <Deck candidates={slimDeck(payload.candidates, [initialIndex - 1, initialIndex, initialIndex + 1])} alerts={payload.watchlistAlerts} savedTickers={savedTickers} takenTickers={takenTickers} date={payload.date} live initialIndex={initialIndex} />
        </>
      )}

      {/* Below the deck on purpose — the top of the screen belongs to the cards. The manual rescan lives on /help. */}
      <div className="mt-1 mb-1 flex flex-col gap-2">
        <PushSetup />
      </div>
    </main>
  );
}
