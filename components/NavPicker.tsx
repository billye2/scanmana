"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NAV_ICONS } from "@/components/NavIcons";
import { ChevronRightIcon } from "@/components/Icons";
import { DEFAULT_NAV, MAX_NAV, NAV_SECTIONS, type NavKey } from "@/lib/nav";

/**
 * The sections list behind the gear (1.6.6): every section in routine order,
 * a tick for the ones the top bar shows (at most MAX_NAV; the rest grey out
 * once the bar is full), and the row itself opens the section. A change is
 * saved at once (POST /api/nav → cookie) and the bar on this page redraws.
 */
export default function NavPicker({ initial }: { initial: NavKey[] }) {
  const router = useRouter();
  const [picks, setPicks] = useState<NavKey[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = picks.length >= MAX_NAV;

  async function save(next: NavKey[]) {
    setPicks(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/nav", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: next }) });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const body = (await res.json()) as { keys: NavKey[] };
      setPicks(body.keys);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: NavKey) {
    const on = picks.includes(key);
    if (!on && full) return;
    void save(on ? picks.filter((k) => k !== key) : [...picks, key]);
  }

  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className={`font-semibold ${full ? "text-emerald-400" : "text-amber-300"}`}>
          {picks.length} of {MAX_NAV} on the bar{saving ? " · saving…" : ""}
        </span>
        <button
          type="button"
          onClick={() => void save([...DEFAULT_NAV])}
          className="rounded-full bg-neutral-900 px-3 py-1 text-neutral-400 active:bg-neutral-800"
        >
          Suggested six
        </button>
      </div>
      {error && <div className="mt-2 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</div>}
      <ul className="mt-3 space-y-2">
        {NAV_SECTIONS.map((s, i) => {
          const Icon = NAV_ICONS[s.key];
          const on = picks.includes(s.key);
          const blocked = !on && full;
          return (
            <li key={s.key} className={`flex items-start gap-3 rounded-xl bg-neutral-900 p-3 ${on ? "ring-1 ring-emerald-500/50" : ""}`}>
              <label className="flex shrink-0 items-center pt-0.5" aria-label={on ? `Remove ${s.label} from the bar` : `Show ${s.label} on the bar`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={blocked || saving}
                  onChange={() => toggle(s.key)}
                  className="h-5 w-5 accent-emerald-400 disabled:opacity-40"
                />
              </label>
              <Link href={s.href} className="flex min-w-0 flex-1 items-start gap-3 active:opacity-70">
                <Icon size={25} className={`mt-0.5 shrink-0 ${on ? "text-emerald-400" : blocked ? "text-neutral-600" : "text-neutral-400"}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[11px] text-neutral-500">#{i + 1}</span>
                    <span className={`font-semibold ${blocked ? "text-neutral-500" : "text-neutral-100"}`}>{s.label}</span>
                    <span className="font-mono text-[11px] text-neutral-500">{s.href}</span>
                    <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-300">{s.cadence}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-neutral-400">{s.why}</span>
                </span>
                <ChevronRightIcon size={18} className="mt-1 shrink-0 text-neutral-600" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
