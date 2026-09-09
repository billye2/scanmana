import LiveWatch from "@/components/LiveWatch";
import TopNav from "@/components/TopNav";
import WatchlistAdd from "@/components/WatchlistAdd";
import WatchlistView, { type WatchlistItem } from "@/components/WatchlistView";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  let items: WatchlistItem[] = [];
  try {
    const sql = getSql();
    items = (await sql`
      SELECT w.ticker,
        w.box_top AS "boxTop",
        w.box_bottom AS "boxBottom",
        b.c AS "lastClose",
        (w.box_top IS NOT NULL AND b.c IS NOT NULL AND b.c > w.box_top) AS broke
      FROM watchlist w
      LEFT JOIN LATERAL (
        SELECT c FROM bars WHERE bars.ticker = w.ticker ORDER BY date DESC LIMIT 1
      ) b ON true
      ORDER BY w.added_at DESC
    `) as WatchlistItem[];
  } catch {
    // DB not configured yet — show empty state
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-3xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-4">
      <TopNav current="/watchlist" subtitle="★ Watchlist" />
      <WatchlistAdd />
      {items.length > 0 && <LiveWatch />}
      <WatchlistView items={items} />
    </main>
  );
}
