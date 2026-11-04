import { addDays } from "./dates";
import type { Bar, DarvasBox } from "./types";

/**
 * Best setups (/gallery, 1.6.4): Kullamägi's monthly review of the charts that
 * worked, from the scanner's own history. A deck row is a "best setup" by what
 * price did in the twenty sessions after the scan night (`research_outcomes.mfe_20`,
 * the best close over the scan-night close). Pure helpers here; the SQL lives in
 * lib/research.ts (`getGallery`) and the bars come from lib/scan.ts (`loadBarWindows`).
 */

export interface GalleryRow {
  date: string;
  ticker: string;
  close: number;
  verdict: "wait" | "pass";
  boxed: boolean;
  boxTop: number | null;
  boxBottom: number | null;
  pivot: number | null;
  adrPct: number;
  tightness: number;
  distFromHigh: number;
  ret1m: number;
  ret3m: number;
  ret6m: number;
  marketBullish: boolean | null;
  /** Best close in the 20 sessions after the scan night over the scan-night close. */
  mfe20: number;
  mae20: number | null;
  broke10d: boolean | null;
  /** 1-based session of the first close above the outcome level, within ten sessions. */
  brokeDay: number | null;
  /** The Auto book's plan on a boxed row that closed under its top (research/outcomes.py k_*). */
  kR: number | null;
  kStopAdr: number | null;
  kEntryDay: number | null;
}

/**
 * The app's candidate for Kullamägi's 5-star setup, as the mission words it: a
 * boxed Wait card still resting under its box top on scan night (the leader that
 * has made its move and is resting in a range; the Darvas box is how the range is
 * found, the Wait verdict is the frameworks' agreement). Same test the research
 * page's "Kullamägi's plan" card uses for its rows. Pure.
 */
export function isFiveStar(row: Pick<GalleryRow, "boxed" | "verdict" | "boxTop" | "close">): boolean {
  return row.boxed && row.verdict === "wait" && row.boxTop !== null && row.close <= row.boxTop;
}

/** Sessions of history drawn before the scan night and the follow-through after it, as calendar days. */
export const GALLERY_BEFORE_DAYS = 140; // ≈ 95 sessions: room for the box and the move into it
export const GALLERY_AFTER_DAYS = 35; // ≈ 24 sessions: the 20 the outcome is scored on, and a little air

/** The bar window to draw for one row. */
export function galleryWindow(scanDate: string): { since: string; until: string } {
  return { since: addDays(scanDate, -GALLERY_BEFORE_DAYS), until: addDays(scanDate, GALLERY_AFTER_DAYS) };
}

/**
 * The rows to show: best follow-through first, one per ticker (a runner sits on the
 * deck for many consecutive nights and would otherwise fill the page by itself),
 * `limit` at most. Pure.
 */
export function pickGallery(rows: GalleryRow[], limit: number): GalleryRow[] {
  const sorted = [...rows].sort((a, b) => b.mfe20 - a.mfe20 || a.date.localeCompare(b.date));
  const seen = new Set<string>();
  const out: GalleryRow[] = [];
  for (const r of sorted) {
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** The box as the chart draws it (top and bottom only; the chart ignores the dates). */
export function galleryBox(row: GalleryRow): DarvasBox | null {
  if (!row.boxed || row.boxTop === null || row.boxBottom === null) return null;
  return { top: row.boxTop, bottom: row.boxBottom, startDate: row.date, confirmed: true };
}

export interface GalleryMarker {
  date: string;
  text: string;
}

/**
 * Markers under the bars: the scan night, then the Auto book's buy (the open after
 * the first close above the box, `kEntryDay` + 1 sessions on) or, when the row has
 * no Auto plan, the session that first closed above the outcome level. Bars that are
 * not on the chart yield no marker. Pure.
 */
export function galleryMarkers(row: GalleryRow, bars: Bar[]): GalleryMarker[] {
  const i = bars.findIndex((b) => b.date === row.date);
  if (i < 0) return [];
  const out: GalleryMarker[] = [{ date: row.date, text: "scan" }];
  if (row.kEntryDay !== null) {
    const buy = bars[i + row.kEntryDay + 1];
    if (buy) out.push({ date: buy.date, text: "buy" });
  } else if (row.brokeDay !== null) {
    const broke = bars[i + row.brokeDay];
    if (broke) out.push({ date: broke.date, text: "broke out" });
  }
  return out;
}

const signedPct = (x: number, digits = 0) => `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(digits)}%`;
const signedR = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`;

/** One line under the chart: what price did, when it broke, what the Auto plan made. Pure. */
export function gallerySentence(row: GalleryRow): string {
  const parts = [`${signedPct(row.mfe20)} best close in 20 sessions`];
  if (row.brokeDay !== null) parts.push(`closed above its ${row.boxed ? "box" : "level"} on day ${row.brokeDay}`);
  else parts.push(`never closed above its ${row.boxed ? "box" : "level"} in 10 sessions`);
  if (row.kR !== null) {
    const stop = row.kStopAdr !== null ? `, stop ${row.kStopAdr.toFixed(1)} ADR wide` : "";
    parts.push(`Auto plan ${signedR(row.kR)}${stop}`);
  } else if (row.boxed && row.brokeDay !== null) {
    parts.push("no Auto trade");
  }
  return parts.join(" · ");
}

/** The scan-night facts, as the card's second line. Pure. */
export function galleryFacts(row: GalleryRow): string {
  const tape = row.marketBullish === null ? "tape unknown" : row.marketBullish ? "Bullish tape" : "Not bullish";
  return [
    `ADR ${row.adrPct.toFixed(1)}%`,
    `tightness ${row.tightness.toFixed(2)}`,
    `${(row.distFromHigh * 100).toFixed(1)}% off the high`,
    `1M ${signedPct(row.ret1m)} · 3M ${signedPct(row.ret3m)} · 6M ${signedPct(row.ret6m)}`,
    tape,
  ].join(" · ");
}

export interface GallerySummary {
  n: number;
  boxedShare: number;
  waitShare: number;
  bullishShare: number | null;
  medianAdr: number;
  medianTightness: number;
  medianDist: number;
  medianRet3m: number;
  medianMfe: number;
  brokeShare: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** What the shown setups had in common on their scan night — his review question. Pure; null on no rows. */
export function gallerySummary(rows: GalleryRow[]): GallerySummary | null {
  if (rows.length === 0) return null;
  const n = rows.length;
  const known = rows.filter((r) => r.marketBullish !== null);
  return {
    n,
    boxedShare: rows.filter((r) => r.boxed).length / n,
    waitShare: rows.filter((r) => r.verdict === "wait").length / n,
    bullishShare: known.length ? known.filter((r) => r.marketBullish).length / known.length : null,
    medianAdr: median(rows.map((r) => r.adrPct)),
    medianTightness: median(rows.map((r) => r.tightness)),
    medianDist: median(rows.map((r) => r.distFromHigh)),
    medianRet3m: median(rows.map((r) => r.ret3m)),
    medianMfe: median(rows.map((r) => r.mfe20)),
    brokeShare: rows.filter((r) => r.broke10d).length / n,
  };
}

/** The summary in one sentence. Pure. */
export function gallerySummaryText(s: GallerySummary): string {
  const share = (x: number) => `${Math.round(x * 100)}%`;
  const parts = [
    `${s.n} setups, median ${signedPct(s.medianMfe)} in 20 sessions`,
    `${share(s.boxedShare)} boxed`,
    `${share(s.waitShare)} Wait`,
    `${share(s.brokeShare)} closed above their level within 10 sessions`,
    `median ADR ${s.medianAdr.toFixed(1)}%`,
    `tightness ${s.medianTightness.toFixed(2)}`,
    `${(s.medianDist * 100).toFixed(1)}% off the high`,
    `3M ${signedPct(s.medianRet3m)}`,
  ];
  if (s.bullishShare !== null) parts.push(`${share(s.bullishShare)} on a Bullish tape`);
  return parts.join(" · ");
}
