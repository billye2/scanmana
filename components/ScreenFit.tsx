import type { ScreenCheck } from "@/lib/screen";

function CheckList({ checks }: { checks: ScreenCheck[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {checks.map((k) => (
        <li key={k.label} className="flex gap-2 text-[12px] leading-snug">
          <span className={`w-3 shrink-0 font-bold ${k.ok ? "text-emerald-400" : "text-red-400"}`}>{k.ok ? "✓" : "✗"}</span>
          <span className="min-w-0 flex-1">
            <span className={k.ok ? "text-neutral-300" : "text-neutral-100"}>{k.label}</span>
            <span className="block text-[11px] text-neutral-500">{k.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Chevron() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-neutral-600 transition-transform group-open:rotate-90"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * Which of the nightly scan's hard rules a symbol passes — the reason it is or
 * isn't in the deck. Both blocks are <details>: collapsed by default on deck
 * cards (everything passes there; the headline chip says so), expanded on
 * lookup pages where the ✗ lines are the content.
 */
export default function ScreenFit({ checks, vcp, inDeck }: { checks: ScreenCheck[]; vcp?: ScreenCheck[]; inDeck: boolean }) {
  const passed = checks.filter((k) => k.ok).length;
  const all = passed === checks.length;
  return (
    <section className="mt-2 mb-4 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-3 lg:mx-auto lg:w-full lg:max-w-2xl">
      <details open={!inDeck} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <Chevron />
          <h3 className="text-sm font-semibold text-neutral-100">Scan fit</h3>
          <span className={`ml-auto text-xs font-semibold ${all ? "text-emerald-300" : "text-red-300"}`}>
            {inDeck ? "in tonight's deck" : all ? "passes the screen" : `fails ${checks.length - passed} of ${checks.length} rules`}
          </span>
        </summary>
        <p className="mt-1.5 text-[11px] text-neutral-500">
          {all
            ? inDeck
              ? "Every hard rule of the nightly screen passes."
              : "Every hard rule passes; it would be in the deck if it ranked inside the top 60 by box-then-tightness."
            : "The nightly scan drops a name on its first failed rule — the ✗ lines are why this one is not in the deck."}
        </p>
        <CheckList checks={checks} />
      </details>
      {vcp && vcp.length > 0 && (
        <details open={!inDeck} className="group mt-3 border-t border-neutral-800 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            <Chevron />
            <h3 className="text-sm font-semibold text-neutral-100">Minervini VCP</h3>
            <span className={`ml-auto text-xs font-semibold ${vcp.every((k) => k.ok) ? "text-emerald-300" : "text-red-300"}`}>
              {vcp.every((k) => k.ok) ? "fulfilled" : `${vcp.filter((k) => !k.ok).length} condition${vcp.filter((k) => !k.ok).length === 1 ? "" : "s"} unmet`}
            </span>
          </summary>
          <p className="mt-1.5 text-[11px] text-neutral-500">
            Analysis lens, not a screen filter — it never decides deck membership; the verdict weighs it.
          </p>
          <CheckList checks={vcp} />
        </details>
      )}
    </section>
  );
}
