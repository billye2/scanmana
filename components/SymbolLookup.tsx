"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Free-form ticker entry → /s/<TICKER>. Read-only: it never touches the nightly scan. */
export default function SymbolLookup({ autoFocus = false, placeholder = "Look up any symbol — AAPL, NVDA…" }: { autoFocus?: boolean; placeholder?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const ticker = value.toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 10);

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ticker) router.push(`/s/${encodeURIComponent(ticker)}`);
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="go"
        placeholder={placeholder}
        aria-label="Symbol"
        className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm font-semibold uppercase tracking-wide text-neutral-100 placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!ticker}
        className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-neutral-200 active:bg-neutral-700 disabled:opacity-40"
      >
        Look up
      </button>
    </form>
  );
}
