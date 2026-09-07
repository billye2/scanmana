"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Result =
  | { status: "ok"; date: string; newSetups: number; watchlistAlerts: number }
  | { status: "skipped"; reason: string; date?: string }
  | { status: "error"; error: string };

export default function RunScanButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/scan/run", { method: "POST" });
      const r = (await res.json()) as Result;
      if (r.status === "ok") {
        setMessage(`${r.date}: ${r.newSetups} setup${r.newSetups === 1 ? "" : "s"}`);
        router.refresh();
      } else if (r.status === "skipped") {
        setMessage(r.reason === "already scanned" ? `Already scanned ${r.date ?? "today"}` : `Skipped: ${r.reason}`);
      } else {
        setMessage(`Failed: ${r.error}`);
      }
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-xs text-neutral-500">{message}</span>}
      <button
        onClick={run}
        disabled={running}
        className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-700 disabled:opacity-50"
      >
        {running ? "Scanning…" : "↻ Run scan for previous day"}
      </button>
    </div>
  );
}
