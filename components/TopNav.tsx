import Link from "next/link";
import type { ReactNode } from "react";
import { SettingsIcon } from "@/components/Icons";
import { NAV_ICONS } from "@/components/NavIcons";
import { navSections } from "@/lib/nav";
import { readSettings } from "@/lib/settings";

/**
 * The one top navigation for every signed-in page: the logo ("SCM" — the full
 * word left the icons no room on a phone, 1.3.9) always links home, a page line
 * sits under it, and on the right the sections the reader picked on /sections
 * (the gear, always last; up to six, in routine order — lib/nav.ts, kept per
 * account since 2.0.3, lib/settings.ts). The current page's icon is lit. `extra` slots
 * page-specific controls before the icons (the symbol page's Live toggle).
 */
export default async function TopNav({ subtitle, current, extra }: { subtitle?: ReactNode; current?: string; extra?: ReactNode }) {
  const picks = (await readSettings()).nav;
  const sections = navSections(picks);
  return (
    <header className="mb-3 flex items-center justify-between">
      <h1 className="min-w-0 text-lg leading-tight font-bold tracking-tight">
        <Link href="/" className="active:opacity-70" aria-label="Scanmana — home">
          <span className="text-emerald-400">◎</span> SCM
        </Link>
        {subtitle && <span className="block truncate text-xs font-normal text-neutral-500">{subtitle}</span>}
      </h1>
      <div className="flex shrink-0 items-center gap-3">
        {extra}
        {sections.map(({ key, href, label }) => {
          const Icon = NAV_ICONS[key];
          return (
            <Link
              key={key}
              href={href}
              aria-label={label}
              aria-current={current === href ? "page" : undefined}
              className={`flex active:text-neutral-200 ${current === href ? "text-emerald-400" : "text-neutral-400"}`}
            >
              <Icon size={25} />
            </Link>
          );
        })}
        <Link
          href="/sections"
          aria-label="Sections — choose the bar's icons"
          aria-current={current === "/sections" ? "page" : undefined}
          className={`flex active:text-neutral-200 ${current === "/sections" ? "text-emerald-400" : "text-neutral-600"}`}
        >
          <SettingsIcon size={21} />
        </Link>
      </div>
    </header>
  );
}
