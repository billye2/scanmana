import DeckLiveList, { type DeckPlan } from "@/components/DeckLiveList";
import TopNav from "@/components/TopNav";
import { getSql } from "@/lib/db";
import { openGroup, openHint } from "@/lib/plan-line";
import { latestBreadth } from "@/lib/research";
import { latestScanSlim } from "@/lib/scan";
import { tapeMultiplier } from "@/lib/tape";
import type { DeckCard, SlimScanPayload } from "@/lib/types";

export const metadata = { title: "Tonight's deck — Scanmana" };
export const dynamic = "force-dynamic";

/**
 * Tonight's deck on one page, grouped by what happens at the open. The group
 * and the row hint come from the Auto book's own arming test, run here on the
 * last two bars of every card (`latestScanSlim({ tail: 2 })`, ~2 KB for the
 * deck) so the list and the ledger cannot disagree; the cards go to the browser
 * without those bars.
 */
export default async function DeckPage() {
  let payload: SlimScanPayload | null = null;
  let saved: string[] = [];
  let cards: DeckCard[] = [];
  const plan: DeckPlan = {};
  let armed = 0;
  try {
    payload = await latestScanSlim({ tail: 2 });
    const rows = (await getSql()`SELECT ticker FROM watchlist`) as { ticker: string }[];
    saved = rows.map((r) => r.ticker);
    const breadth = await latestBreadth().catch(() => null);
    const tape = payload ? tapeMultiplier(payload.market ? payload.market.verdict === "bullish" : null, breadth?.today.pctAbove20 ?? null) : null;
    for (const c of payload?.candidates ?? []) {
      const group = openGroup(c, c.bars);
      plan[c.ticker] = { group, hint: openHint(c, group, c.bars, tape?.mult ?? 1) };
      if (group === "arms") armed++;
      const { bars: _bars, ...rest } = c;
      void _bars;
      cards.push(rest);
    }
  } catch {
    // DB not configured yet — empty state below
    cards = [];
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-3xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav
        current="/deck"
        subtitle={payload ? `Tonight's deck · ${cards.length} · ${armed} arm${armed === 1 ? "s" : ""} · ${payload.date}` : "Tonight's deck"}
      />
      {!payload || cards.length === 0 ? (
        <p className="mt-16 text-center text-sm text-neutral-500">No scan yet — nothing to list.</p>
      ) : (
        <DeckLiveList candidates={cards} saved={saved} plan={plan} />
      )}
    </main>
  );
}
