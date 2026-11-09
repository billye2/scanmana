"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TEXT_SIZES, type TextSize } from "@/lib/nav";

/**
 * The text-size pills on /sections (1.8.8): Default · Large · Larger. A tap saves
 * at once (POST /api/text → cookie) and the page re-renders with the new size, so
 * the change is visible where it was made.
 */
export default function TextSizePicker({ initial }: { initial: TextSize }) {
  const router = useRouter();
  const [size, setSize] = useState<TextSize>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: TextSize) {
    if (saving || next === size) return;
    setSize(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ size: next }) });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const note = TEXT_SIZES.find((s) => s.key === size)?.note ?? "";

  return (
    <div className="rounded-xl bg-neutral-900 px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-neutral-100">Text size</span>
        <span className="text-[11px] text-neutral-500">{saving ? "saving…" : note}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Text size">
        {TEXT_SIZES.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={s.key === size}
            onClick={() => void save(s.key)}
            className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${s.key === size ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-300 active:bg-neutral-700"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-neutral-500">
        Scales every line of text in the app on this device; the charts keep their own small labels. The home-screen app cannot pinch-zoom, so this is the way to make the Help pages readable.
      </p>
      {error && <div className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</div>}
    </div>
  );
}
