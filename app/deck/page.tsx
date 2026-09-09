import DeckLiveList from "@/components/DeckLiveList";
import TopNav from "@/components/TopNav";
import { getSql } from "@/lib/db";
import { latestScan } from "@/lib/scan";
import type { ScanPayload } from "@/lib/types";

export const metadata = { title: "Tonight's deck — Scanmana" };
export const dynamic = "force-dynamic";

/** Tonight's deck on one page — verdicts, and live grouping while quotes are available. */
export default async function DeckPage() {
  let payload: ScanPayload | null = null;
  let saved: string[] = [];
  try {
    payload = await latestScan();
    const rows = (await getSql()`SELECT ticker FROM watchlist`) as { ticker: string }[];
    saved = rows.map((r) => r.ticker);
  } catch {
    // DB not configured yet — empty state below
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-3xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav
        current="/deck"
        subtitle={payload ? `Tonight's deck · ${payload.candidates.length} · ${payload.date}` : "Tonight's deck"}
      />
      {!payload || payload.candidates.length === 0 ? (
        <p className="mt-16 text-center text-sm text-neutral-500">No scan yet — nothing to list.</p>
      ) : (
        <DeckLiveList candidates={payload.candidates} saved={saved} />
      )}
    </main>
  );
}
