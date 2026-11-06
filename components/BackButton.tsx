"use client";

import { useRouter } from "next/navigation";
import { ChevronLeftIcon } from "@/components/Icons";
import { backAction } from "@/lib/nav";

/**
 * Back for the home-screen app (1.8.4). iOS draws no browser chrome around a
 * standalone PWA and offers no edge-swipe, so a deep page needs its own way
 * out. History back when the app got here by a tap; the fallback when the
 * page was opened cold (a reload, a pasted link). Lives in the bottom bar's
 * left slot, never beside the logo (Billy, 2026-11-05).
 */
export default function BackButton({ fallback, className }: { fallback: string; className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (backAction(window.history.length) === "back" ? router.back() : router.push(fallback))}
      className={className}
      aria-label="Back"
    >
      <ChevronLeftIcon size={25} />
    </button>
  );
}
