import Link from "next/link";
import type { ReactNode } from "react";
import { BriefcaseIcon, HelpCircleIcon, ListIcon, SearchIcon, StarIcon } from "@/components/Icons";

const ICONS: { href: string; label: string; Icon: typeof ListIcon }[] = [
  { href: "/help", label: "Help", Icon: HelpCircleIcon },
  { href: "/s", label: "Look up a symbol", Icon: SearchIcon },
  { href: "/watchlist", label: "Watchlist", Icon: StarIcon },
  { href: "/paper", label: "Paper trading", Icon: BriefcaseIcon },
  { href: "/deck", label: "Tonight's deck as a list", Icon: ListIcon },
];

/**
 * The one top navigation for every signed-in page: the Scanmana logo always
 * links home, a page line sits under it, and the same five icons sit on the
 * right (the current page's icon is lit). `extra` slots page-specific controls
 * before the icons (the symbol page's Live toggle).
 */
export default function TopNav({ subtitle, current, extra }: { subtitle?: ReactNode; current?: string; extra?: ReactNode }) {
  return (
    <header className="mb-3 flex items-center justify-between">
      <h1 className="min-w-0 text-lg leading-tight font-bold tracking-tight">
        <Link href="/" className="active:opacity-70" aria-label="Scanmana — home">
          <span className="text-emerald-400">◎</span> Scanmana
        </Link>
        {subtitle && <span className="block truncate text-xs font-normal text-neutral-500">{subtitle}</span>}
      </h1>
      <div className="flex shrink-0 items-center gap-3">
        {extra}
        {ICONS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={current === href ? "page" : undefined}
            className={`flex active:text-neutral-200 ${current === href ? "text-emerald-400" : "text-neutral-400"}`}
          >
            <Icon size={25} />
          </Link>
        ))}
      </div>
    </header>
  );
}
