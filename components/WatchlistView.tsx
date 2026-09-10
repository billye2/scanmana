"use client";

import { BellIcon } from "@/components/Icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { price } from "@/lib/format";

export interface WatchlistItem {
  ticker: string;
  boxTop: number | null;
  boxBottom: number | null;
  lastClose: number | null;
  broke: boolean;
}

export default function WatchlistView({ items, taken = [] }: { items: WatchlistItem[]; taken?: string[] }) {
  const router = useRouter();
  const [takenSet, setTakenSet] = useState<Set<string>>(new Set(taken));
  const [stopFor, setStopFor] = useState<string | null>(null); // row without a stop line: which one has the input open
  const [stopText, setStopText] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Arm the row's trigger/stop in the manual paper book; a row with no stop asks for one first. */
  async function take(w: WatchlistItem) {
    if (w.boxTop === null) return;
    let stop: number | undefined;
    if (w.boxBottom === null) {
      if (stopFor !== w.ticker) {
        setStopFor(w.ticker);
        setStopText("");
        return;
      }
      stop = Number(stopText);
      if (!(stop > 0 && stop < w.boxTop)) {
        setError(`${w.ticker}: stop must be a price below the trigger`);
        return;
      }
    }
    setError(null);
    const res = await fetch("/api/paper/take", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: w.ticker, stop }),
    });
    if (res.ok) {
      setTakenSet((cur) => new Set(cur).add(w.ticker));
      setStopFor(null);
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(`${w.ticker}: ${j.error ?? `take failed (${res.status})`}`);
    }
  }

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
    <>
    {error && <p className="mb-1 text-xs text-red-300">{error}</p>}
    <ul className="divide-y divide-neutral-800">
      {items.map((w) => (
        <li key={w.ticker} className="flex items-center justify-between gap-2 py-3">
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
          {w.boxTop !== null && stopFor === w.ticker && !takenSet.has(w.ticker) && (
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="stop"
              value={stopText}
              onChange={(e) => setStopText(e.target.value)}
              className="w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
              aria-label={`Stop price for ${w.ticker}`}
            />
          )}
          {w.boxTop !== null && (
            <button
              onClick={() => take(w)}
              disabled={takenSet.has(w.ticker)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${takenSet.has(w.ticker) ? "bg-neutral-800 text-neutral-500" : "bg-emerald-700 text-white active:bg-emerald-600"}`}
              aria-label={
                takenSet.has(w.ticker)
                  ? "Taken into the manual paper book"
                  : w.lastClose !== null && w.lastClose > w.boxTop
                    ? "Take — buy at the next open in the manual paper book (price is already above the trigger)"
                    : "Take — arm this buy-stop in the manual paper book"
              }
            >
              {takenSet.has(w.ticker) ? "Taken" : w.lastClose !== null && w.lastClose > w.boxTop ? "Take at open" : "Take"}
            </button>
          )}
          <button
            onClick={() => remove(w.ticker)}
            className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-700"
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
    </>
  );
}
