/**
 * The top bar's sections (1.6.6). Every signed-in page carries the same icons;
 * which six is the reader's choice, made on /sections (the gear) and kept in a
 * cookie, so the bar can be rebuilt around the routine without a redeploy. The
 * registry below is ranked by how often Kullamägi's process has you open each
 * page (2026-11-03): the bar draws the picks in this order, so the first thing
 * needed each evening is the first icon. Pure; the cookie is read in TopNav and
 * written by POST /api/nav.
 */

export type NavKey = "deck" | "paper" | "gallery" | "drill" | "research" | "studies" | "tape" | "watchlist" | "sim" | "lookup" | "help";

export interface NavSection {
  key: NavKey;
  href: string;
  label: string;
  /** How often his routine has you open it. */
  cadence: string;
  /** The piece of his method the page carries. */
  why: string;
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: "deck",
    href: "/deck",
    label: "Deck list grouped by the open",
    cadence: "every evening",
    why: "The nightly decision: what arms tonight, what sits inside its box, what is not ready. He scans every night and places the order before the open; this is that page.",
  },
  {
    key: "paper",
    href: "/paper",
    label: "Paper book · At the open",
    cadence: "every morning",
    why: "Managing by rule: half off on day 4, breakeven, out on a close under the 10-day. What the rules do tomorrow, how each hold stands, the record in R.",
  },
  {
    key: "gallery",
    href: "/gallery",
    label: "Best setups",
    cadence: "weekly",
    why: "His monthly review of the charts that worked. Pattern recognition comes from this page, not from the deck.",
  },
  {
    key: "drill",
    href: "/drill",
    label: "Drill",
    cadence: "a few charts a day",
    why: "His eye came from thousands of charts with the right side covered. A past deck card up to its scan night, name hidden: Take or Skip, then look. Your record against the 5-star rule.",
  },
  {
    key: "research",
    href: "/research",
    label: "Research",
    cadence: "weekly",
    why: "“Verify every setup.” The week's read, the scorecard, the rule-change rows, the plan scored on history.",
  },
  {
    key: "studies",
    href: "/studies",
    label: "Studies",
    cadence: "weekly",
    why: "The deeper reads behind the rules: the plan on every boxed Wait card, breakout rates, the EP study, the sweep, breadth, themes. A rule changes only when a study says so.",
  },
  {
    key: "tape",
    href: "/tape",
    label: "Tape",
    cadence: "every evening",
    why: "His first rule: the index decides whether breakouts work at all. The verdict and breadth over time, the streak, and the size the book takes from them.",
  },
  {
    key: "watchlist",
    href: "/watchlist",
    label: "Watchlist",
    cadence: "as needed",
    why: "The names you chose to follow, with the live breakout buckets during the day.",
  },
  {
    key: "sim",
    href: "/sim",
    label: "Stop simulator",
    cadence: "occasional",
    why: "For a trade taken off plan: his stop, the ladder of levels, the rest of the routine.",
  },
  {
    key: "lookup",
    href: "/s",
    label: "Symbol lookup",
    cadence: "utility",
    why: "Any symbol as a deck card with the scan-fit checklist.",
  },
  {
    key: "help",
    href: "/help",
    label: "Help",
    cadence: "reference",
    why: "Every term, the index charts, the sign-out. Always one tap away through this page, icon or not.",
  },
];

/** The bar holds this many section icons beside the logo and the gear on a phone. */
export const MAX_NAV = 6;
/** The suggested six, in routine order. */
export const DEFAULT_NAV: readonly NavKey[] = ["deck", "paper", "gallery", "research", "watchlist", "lookup"];
export const NAV_COOKIE = "scm_nav";

const KEYS = new Set<string>(NAV_SECTIONS.map((s) => s.key));
const RANK = new Map<string, number>(NAV_SECTIONS.map((s, i) => [s.key, i]));

/**
 * The picks a stored value stands for: unknown keys dropped, duplicates
 * removed, at most MAX_NAV kept, always in registry order. An absent or empty
 * value means the default six; a value with no valid key means an empty bar
 * (the reader unticked everything — the gear still shows).
 */
export function parseNav(raw: string | string[] | null | undefined): NavKey[] {
  if (raw === null || raw === undefined) return [...DEFAULT_NAV];
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const picked = new Set<NavKey>();
  for (const p of parts) {
    const k = p.trim();
    if (KEYS.has(k)) picked.add(k as NavKey);
  }
  if (!Array.isArray(raw) && raw.trim() === "") return [...DEFAULT_NAV];
  return [...picked].sort((a, b) => RANK.get(a)! - RANK.get(b)!).slice(0, MAX_NAV);
}

/** The cookie value for a set of picks (registry order, validated). */
export function navCookieValue(keys: readonly string[]): string {
  return parseNav([...keys]).join(",");
}

/** The sections the bar draws, in order. */
export function navSections(keys: readonly NavKey[]): NavSection[] {
  return keys.map((k) => NAV_SECTIONS.find((s) => s.key === k)!).filter(Boolean);
}

/** The home deck's bottom bar carries this many section links between prev and the counter. */
export const BOTTOM_BAR_LINKS = 4;

/**
 * The home deck's bottom bar follows the top bar (1.6.8): the first picks, in
 * order. Four since 1.6.9, when the card's watch star left the bar for the
 * ticker line at Billy's request ("remove watch list from bottom nav"). Pure.
 */
export function bottomBarLinks(keys: readonly NavKey[]): NavSection[] {
  return navSections(keys).slice(0, BOTTOM_BAR_LINKS);
}

/**
 * What the bottom bar's Back does (1.8.4). The home-screen app has no browser
 * chrome, so a deep page (a symbol, /sim) carries its own Back: history back
 * when the app got here by a tap, the page's fallback when it was opened cold
 * (a reload or a pasted link leaves one history entry). Pure.
 */
export function backAction(historyLength: number): "back" | "fallback" {
  return historyLength > 1 ? "back" : "fallback";
}
