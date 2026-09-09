import TopNav from "@/components/TopNav";
import SymbolLookup from "@/components/SymbolLookup";

export const dynamic = "force-static";

export default function LookupPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-2xl pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),8px)]">
      <TopNav current="/s" subtitle="Look up a symbol — any US stock in the bar store; read-only, never changes the nightly deck" />
      <SymbolLookup autoFocus />
      <p className="mt-4 text-[13px] leading-relaxed text-neutral-400">
        You get the same card the deck shows — chart with Darvas box and Livermore pivot, badges, the Wait / Pass analysis — plus a
        <span className="text-neutral-200"> Scan fit</span> checklist: each hard rule of the nightly screen with the number behind it, so
        you can see exactly why, say, AAPL or NVDA is or isn&apos;t a Scanmana setup tonight.
      </p>
    </main>
  );
}
