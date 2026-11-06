"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { NAV_ICONS } from "@/components/NavIcons";
import type { NavSection } from "@/lib/nav";

/** One column each, the same icon size and colours as the top nav. */
export const BAR_ITEM = "flex items-center justify-center py-2.5 text-neutral-400 active:text-neutral-100 disabled:opacity-30";

/**
 * The fixed bottom bar (extracted from Deck in 1.8.4 so /sim can carry one).
 * Equal columns: a left control, the section links, an optional right control.
 * Pages pad their bottom (`pb-[calc(env(safe-area-inset-bottom)+80px)]`) so
 * nothing hides under it. Icon-only, because text buttons rendered in
 * mismatched fallback fonts on iPhone.
 */
export default function BottomBar({ left, links, right }: { left: ReactNode; links: readonly NavSection[]; right?: ReactNode }) {
  const columns = 1 + links.length + (right ? 1 : 0);
  return (
    <nav
      aria-label="Deck navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-[#0a0e14]/95 pt-1 pb-[max(env(safe-area-inset-bottom),6px)] backdrop-blur"
    >
      <div className="mx-auto grid w-full max-w-xl" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {left}
        {links.map((s) => {
          const Icon = NAV_ICONS[s.key];
          return (
            <Link key={s.key} href={s.href} className={BAR_ITEM} aria-label={s.label}>
              <Icon size={25} />
            </Link>
          );
        })}
        {right}
      </div>
    </nav>
  );
}
