"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ResearchRunResult, SplitRow } from "@/lib/research";

const BTN = "rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-700 disabled:opacity-40";

/** Runs every research job now (POST /api/research/run) and reports what each did. */
export function ResearchRefresh() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResearchRunResult | null>(null);
  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/research/run", { method: "POST" });
      setResult((await res.json()) as ResearchRunResult);
      router.refresh();
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err), results: [] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button onClick={run} disabled={busy} className={BTN}>
        {busy ? "Running the research jobs… (up to 5 min)" : "↻ Refresh research now"}
      </button>
      {result?.error && <p className="text-xs text-red-300">{result.error}</p>}
      {result?.skipped && <p className="text-xs text-neutral-500">{result.skipped}</p>}
      {result && result.results.length > 0 && (
        <ul className="text-[11px] text-neutral-500">
          {result.results.map((r) => (
            <li key={r.job}>
              <span className="text-neutral-300">{r.job}</span> · {r.status}
              {r.note ? ` — ${r.note}` : ""}
              {r.seconds ? ` (${r.seconds}s)` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inline rename for a theme cluster. Python groups; the name is yours. */
export function ClusterAlias({ clusterKey, alias }: { clusterKey: string; alias: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(alias ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    await fetch("/api/research/alias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clusterKey, alias: value }) });
    setBusy(false);
    setEditing(false);
    router.refresh();
  }
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-[11px] text-neutral-500 underline decoration-neutral-700 underline-offset-4 active:text-neutral-300" aria-label="Name this theme">
        {alias ? "rename" : "name it"}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="e.g. AI networking"
        maxLength={40}
        className="w-36 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-100"
        autoFocus
      />
      <button onClick={save} disabled={busy} className={BTN}>Save</button>
      <button onClick={() => setEditing(false)} className={BTN}>Cancel</button>
    </span>
  );
}

/** Confirm (adjust the bars) or dismiss a detected split. */
export function SplitActions({ row }: { row: SplitRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(status: SplitRow["status"]) {
    setBusy(true);
    await fetch("/api/research/split", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: row.ticker, date: row.date, status }) });
    setBusy(false);
    router.refresh();
  }
  return (
    <span className="flex gap-1">
      {row.status !== "auto" && <button onClick={() => set("auto")} disabled={busy} className={BTN}>Confirm</button>}
      {row.status !== "ignored" && <button onClick={() => set("ignored")} disabled={busy} className={BTN}>Dismiss</button>}
      {row.status === "ignored" && <button onClick={() => set("review")} disabled={busy} className={BTN}>Undo</button>}
    </span>
  );
}
