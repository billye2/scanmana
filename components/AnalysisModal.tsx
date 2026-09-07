"use client";

import { useEffect, useState } from "react";
import type { Analysis, FrameworkView } from "@/lib/types";
import { verdictChip, verdictLabel } from "@/lib/verdict";


function Section({ title, who, view }: { title: string; who: string; view: FrameworkView }) {
  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-neutral-100">
          {title} <span className="ml-1 text-[11px] font-normal text-neutral-500">{who}</span>
        </h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${verdictChip(view.verdict)}`}>{verdictLabel(view.verdict)}</span>
      </div>
      <ul className="mt-1.5 space-y-1.5 text-[13px] leading-relaxed text-neutral-300">
        {view.points.map((p, i) => (
          <li key={i} className="pl-3 -indent-3">
            <span className="text-neutral-600">· </span>
            {p}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AnalysisModal({ ticker, date, override, onClose }: { ticker: string; date: string; override?: Analysis; onClose: () => void }) {
  const [a, setA] = useState<Analysis | null>(override ?? null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (override) return; // computed at render time — nothing stored to fetch
    let alive = true;
    fetch(`/api/analysis?ticker=${encodeURIComponent(ticker)}${date ? `&date=${date}` : ""}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.statusText))))
      .then((j) => alive && setA(j))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [ticker, date, override]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="max-h-[88dvh] w-full max-w-xl overflow-y-auto lg:max-w-2xl rounded-t-2xl bg-[#0f141b] px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {ticker} <span className="text-xs font-normal text-neutral-500">{a?.date ?? date}</span>
          </h2>
          <button onClick={onClose} className="rounded-lg bg-neutral-800 px-3 py-1 text-sm text-neutral-300 active:bg-neutral-700" aria-label="Close">
            ✕
          </button>
        </div>

        {err && <p className="mt-4 text-sm text-neutral-500">{err === "no analysis stored" ? "No analysis stored for this symbol yet — it gets one the night it appears in a scan." : err}</p>}
        {!a && !err && <p className="mt-4 text-sm text-neutral-500">Loading…</p>}
        {a && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdictChip(a.overall)}`}>{verdictLabel(a.overall)}</span>
              <span className="text-[13px] text-neutral-300">{a.summary}</span>
            </div>
            {a.plan && <p className="mt-2 text-[13px] text-amber-300">{a.plan}</p>}
            <Section title="Qullamaggie" who="breakout rules" view={a.qullamaggie} />
            <Section title="Livermore" who="pivotal point" view={a.livermore} />
            <Section title="Darvas" who="box" view={a.darvas} />
            {a.minervini && <Section title="Minervini" who="VCP" view={a.minervini} />}
            <p className="mt-5 text-[11px] text-neutral-600">
              {override
                ? "Computed now from stored bars — this symbol isn't in the scan results, so nothing is stored. "
                : "Rule-based read of the stored scan data. "}
              Not advice. Thresholds in lib/config.ts → ANALYSIS.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
