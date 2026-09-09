"use client";

import Link from "next/link";
import LiveChip from "@/components/LiveChip";
import { useLive } from "@/components/useLive";
import { price, pct } from "@/lib/format";
import type { LiveWatchBundle } from "@/lib/livewatch";

/** Polls /api/watchlist/live every 60s while the page is visible (market hours pace the server cache). */
export default function LiveWatch() {
  const { data, err } = useLive<LiveWatchBundle>("/api/watchlist/live");

  if (err) return <p className="mb-3 text-[11px] text-sky-300/80">live status unavailable ({err}) — showing stored levels below</p>;
  if (!data || data.rows.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">Live</h2>
        <span className="text-[11px] text-neutral-500">
          as of {data.asOf}{data.live ? "" : " · market closed"}
        </span>
      </div>
      <ul className="mt-2 space-y-2">
        {data.rows.map((r) => (
          <li key={r.ticker}>
            <Link href={`/s/${r.ticker}?live=1`} className="flex items-center gap-2 active:opacity-70">
              <span className="w-14 shrink-0 font-semibold">{r.ticker}</span>
              <LiveChip status={r.status} muted={!data.live} />
              <span className="min-w-0 flex-1 truncate text-right text-[11px] text-neutral-500">
                {r.toTriggerPct !== null && r.toTriggerPct > 0 && <>{pct(r.toTriggerPct, 1)} to trigger · </>}
                {r.aboveOpen ? "above open" : "below open"}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-neutral-200">{price(r.price)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
