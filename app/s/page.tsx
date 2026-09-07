import Link from "next/link";
import SymbolLookup from "@/components/SymbolLookup";

export const dynamic = "force-static";

export default function LookupPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-2xl pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),8px)]">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-lg leading-tight font-bold tracking-tight">
          <span className="text-emerald-400">◎</span> Look up a symbol
          <span className="block text-xs font-normal text-neutral-500">any US stock in the bar store — read-only, never changes the nightly deck</span>
        </h1>
        <Link href="/" className="text-sm text-neutral-400 active:text-neutral-200">
          Deck
        </Link>
      </header>
      <SymbolLookup autoFocus />
      <p className="mt-4 text-[13px] leading-relaxed text-neutral-400">
        You get the same card the deck shows — chart with Darvas box and Livermore pivot, badges, the Wait / Pass analysis — plus a
        <span className="text-neutral-200"> Scan fit</span> checklist: each hard rule of the nightly screen with the number behind it, so
        you can see exactly why, say, AAPL or NVDA is or isn&apos;t a Scanmana setup tonight.
      </p>
    </main>
  );
}
