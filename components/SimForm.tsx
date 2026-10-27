"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const INPUT =
  "min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none";

/**
 * Symbol, entry price, optional entry date and share count → /sim?t=&p=&d=&n=.
 * Read-only: the page prices a stop from stored bars and writes nothing.
 */
export default function SimForm({ initial, today }: { initial: { t?: string; p?: string; d?: string; n?: string }; today: string }) {
  const router = useRouter();
  const [t, setT] = useState(initial.t ?? "");
  const [p, setP] = useState(initial.p ?? "");
  const [d, setD] = useState(initial.d ?? "");
  const [n, setN] = useState(initial.n ?? "");
  const ticker = t.toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 10);
  const entry = Number(p);
  const ok = ticker.length > 0 && entry > 0;

  return (
    <form
      className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        const q = new URLSearchParams({ t: ticker, p: String(entry) });
        if (d) q.set("d", d);
        if (Number(n) >= 1) q.set("n", String(Math.floor(Number(n))));
        router.push(`/sim?${q.toString()}`);
      }}
    >
      <input
        value={t}
        onChange={(e) => setT(e.target.value)}
        autoFocus={!initial.t}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Symbol"
        aria-label="Symbol"
        className={`${INPUT} font-semibold uppercase tracking-wide placeholder:font-normal placeholder:normal-case placeholder:tracking-normal`}
      />
      <input
        value={p}
        onChange={(e) => setP(e.target.value)}
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        placeholder="Entry price"
        aria-label="Entry price"
        className={INPUT}
      />
      <input value={d} onChange={(e) => setD(e.target.value)} type="date" max={today} aria-label="Entry date (defaults to the latest session)" className={`${INPUT} text-neutral-300`} />
      <input
        value={n}
        onChange={(e) => setN(e.target.value)}
        type="number"
        step="1"
        min="1"
        inputMode="numeric"
        placeholder="Shares (optional)"
        aria-label="Shares"
        className={INPUT}
      />
      <button
        type="submit"
        disabled={!ok}
        className="col-span-2 rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-neutral-200 active:bg-neutral-700 disabled:opacity-40 sm:col-span-1"
      >
        Price the stop
      </button>
    </form>
  );
}
