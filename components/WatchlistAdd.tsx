"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Add a symbol to the (communal) watchlist by hand; the server computes trigger/stop from stored bars. */
export default function WatchlistAdd() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ticker = value.toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 10);

  async function add() {
    if (!ticker || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }), // no box fields → the server derives them from bars
      });
      if (!res.ok) {
        setErr(((await res.json()) as { error?: string }).error ?? res.statusText);
        return;
      }
      setValue("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="Add a symbol — AAPL, NVDA…"
          aria-label="Add symbol"
          className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm font-semibold uppercase tracking-wide text-neutral-100 placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!ticker || busy}
          className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-neutral-200 active:bg-neutral-700 disabled:opacity-40"
        >
          {busy ? "…" : "Add"}
        </button>
      </form>
      {err && <p className="mt-1.5 text-[11px] text-red-300">{err}</p>}
    </div>
  );
}
