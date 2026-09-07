"use client";

import { useEffect } from "react";
import { price } from "@/lib/format";
import type { Candidate, Verdict } from "@/lib/types";
import { VERDICTS, verdictChip, verdictLabel } from "@/lib/verdict";
import { ListIcon } from "@/components/Icons";


export default function DeckList({
  candidates,
  current,
  saved,
  onPick,
  onClose,
}: {
  candidates: Candidate[];
  current: number;
  saved: Set<string>;
  onPick: (idx: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const count = (v: Verdict) => candidates.filter((c) => c.verdict === v).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-2xl bg-[#0f141b] pt-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:rounded-2xl lg:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ListIcon size={20} /> Tonight&apos;s deck <span className="ml-1 text-sm font-normal text-neutral-500">{candidates.length}</span>
          </h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-neutral-400 active:text-neutral-100" aria-label="close">
            ✕
          </button>
        </div>
        <div className="mt-1 flex gap-2 px-4 text-[11px]">
          {VERDICTS.map((v) => (
            <span key={v} className={`rounded-full px-2 py-0.5 font-semibold ${verdictChip(v)}`}>
              {count(v)} {verdictLabel(v)}
            </span>
          ))}
        </div>
        <ul className="mt-2 flex-1 overflow-y-auto border-t border-neutral-800">
          {candidates.map((c, i) => (
            <li key={c.ticker}>
              <button
                onClick={() => onPick(i)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-neutral-800 ${
                  i === current ? "bg-neutral-900" : ""
                }`}
              >
                <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-neutral-600">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-semibold">{c.ticker}</span>
                    {saved.has(c.ticker) && <span className="text-[11px] text-amber-400">★</span>}
                    {c.box && <span className="text-[11px] text-neutral-500">box</span>}
                  </span>
                  <span className="block truncate text-[11px] text-neutral-500">{c.name}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-neutral-300">{price(c.price)}</span>
                <span className={`w-12 shrink-0 rounded-full py-0.5 text-center text-[11px] font-semibold ${verdictChip(c.verdict)}`}>
                  {verdictLabel(c.verdict) ?? "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
