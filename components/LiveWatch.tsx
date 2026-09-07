"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { price, pct } from "@/lib/format";
import type { LiveWatchBundle, WatchStatus } from "@/lib/livewatch";

const CHIP: Record<WatchStatus, [string, string]> = {
  breaking: ["⚡ breaking out", "bg-emerald-500/90 text-neutral-950"],
  failed: ["failed back inside", "bg-red-900/70 text-red-200"],
  stopped: ["below stop", "bg-red-900/70 text-red-200"],
  approaching: ["approaching", "bg-amber-900/70 text-amber-200"],
  quiet: ["quiet", "bg-neutral-800 text-neutral-400"],
};

/** Polls /api/watchlist/live every 60s while the page is visible (market hours pace the server cache). */
export default function LiveWatch() {
  const [data, setData] = useState<LiveWatchBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/watchlist/live")
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
        .then((j) => { if (alive) { setData(j); setErr(null); } })
        .catch((e) => alive && setErr(e.message));
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

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
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${CHIP[r.status][1]}`}>
                {CHIP[r.status][0]}
              </span>
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
