"use client";

import { BellIcon } from "@/components/Icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { price } from "@/lib/format";

export interface WatchlistItem {
  ticker: string;
  boxTop: number | null;
  boxBottom: number | null;
  lastClose: number | null;
  broke: boolean;
}

export default function WatchlistView({ items }: { items: WatchlistItem[] }) {
  const router = useRouter();

  async function remove(ticker: string) {
    await fetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    });
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="mt-16 text-center text-sm text-neutral-500">Nothing saved yet — star setups from the deck.</p>;
  }

  return (
    <ul className="divide-y divide-neutral-800">
      {items.map((w) => (
        <li key={w.ticker} className="flex items-center justify-between py-3">
          <Link href={`/s/${w.ticker}`} className="min-w-0 flex-1 active:opacity-70">
            <div className="flex items-center gap-2">
              <span className="font-semibold underline decoration-neutral-700 underline-offset-4">{w.ticker}</span>
              {w.broke && (
                <span className="rounded-full bg-emerald-900/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                  <BellIcon size={12} /> broke box
                </span>
              )}
            </div>
            <div className="text-xs text-neutral-500">
              {w.boxTop !== null ? (
                <>
                  trigger {price(w.boxTop)}
                  {w.boxBottom !== null && <> · stop {price(w.boxBottom)}</>}
                </>
              ) : (
                "no box saved"
              )}
              {w.lastClose !== null && <> · last {price(w.lastClose)}</>}
            </div>
          </Link>
          <button
            onClick={() => remove(w.ticker)}
            className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-700"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
