import Link from "next/link";
import Deck from "@/components/Deck";
import MarketBar from "@/components/MarketBar";
import PushSetup from "@/components/PushSetup";
import { HelpCircleIcon, SearchIcon, StarIcon } from "@/components/Icons";
import { getSql } from "@/lib/db";
import { latestScan } from "@/lib/scan";
import type { ScanPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let payload: ScanPayload | null = null;
  let savedTickers: string[] = [];
  let dbError = false;
  try {
    payload = await latestScan();
    const sql = getSql();
    const rows = (await sql`SELECT ticker FROM watchlist`) as { ticker: string }[];
    savedTickers = rows.map((r) => r.ticker);
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-none lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[calc(env(safe-area-inset-bottom)+80px)]">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-lg leading-tight font-bold tracking-tight">
          <span className="text-emerald-400">◎</span> Scanmana
          {payload && <span className="block text-xs font-normal text-neutral-500">{payload.date}</span>}
        </h1>
        <div className="flex items-center gap-3">
          <span id="deck-camera-slot" className="flex items-center empty:hidden" />
          <Link href="/help" className="flex text-neutral-500 active:text-neutral-200" aria-label="Help">
            <HelpCircleIcon size={25} />
          </Link>
          <Link href="/s" className="flex text-neutral-400 active:text-neutral-200" aria-label="Look up a symbol">
            <SearchIcon size={25} />
          </Link>
          <Link href="/watchlist" className="flex text-neutral-400 active:text-neutral-200" aria-label="Watchlist">
            <StarIcon size={25} />
          </Link>
          <span id="deck-list-slot" className="flex items-center empty:hidden" />
        </div>
      </header>

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
          <Deck candidates={payload.candidates} alerts={payload.watchlistAlerts} savedTickers={savedTickers} date={payload.date} live />
        </>
      )}

      {/* Below the deck on purpose — the top of the screen belongs to the cards. The manual rescan lives on /help. */}
      <div className="mt-1 mb-1 flex flex-col gap-2">
        <PushSetup />
      </div>
    </main>
  );
}
