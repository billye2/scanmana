import { CONFIG } from "./config";
import { getSql } from "./db";

const T = CONFIG.PAPER.TAPE;

export type SizeLabel = "full" | "half" | "quarter";

export interface Tape {
  date: string; // the session it was read for
  bullish: boolean | null; // index filter verdict as of that session (null = no scan)
  breadth: number | null; // share of the universe above its 20-day average, latest known (null = research not run yet)
  mult: number; // notional multiplier
  label: SizeLabel;
  reason: string;
}

/**
 * Position-size multiplier from the two tape signals. Both on → full; one on →
 * half; neither → quarter. A signal that is unknown (null) is left out rather
 * than counted against the trade, so a fresh install with no breadth yet sizes
 * on the index alone, and with neither known it sizes full. Pure.
 */
export function tapeMultiplier(bullish: boolean | null, breadth: number | null): { mult: number; label: SizeLabel; reason: string } {
  const signals: boolean[] = [];
  const why: string[] = [];
  if (bullish !== null) {
    signals.push(bullish);
    why.push(bullish ? "index Bullish" : "index not bullish");
  }
  if (breadth !== null) {
    const on = breadth >= T.BREADTH_MIN;
    signals.push(on);
    why.push(`breadth ${Math.round(breadth * 100)}%${on ? "" : ` (under ${Math.round(T.BREADTH_MIN * 100)}%)`}`);
  }
  const on = signals.filter(Boolean).length;
  const reason = why.length ? why.join(", ") : "no tape data";
  if (signals.length === 0 || on === signals.length) return { mult: 1, label: "full", reason };
  if (on === 0) return { mult: T.NO_SIGNAL, label: "quarter", reason };
  return { mult: T.ONE_SIGNAL, label: "half", reason };
}

/**
 * The tape as known on the night `date` is processed: the index verdict stored
 * with that day's scan (or the latest before it) and the latest breadth row on
 * or before it. Breadth for `date` itself is written by the research job after
 * the paper book runs, so in practice it is the prior session's reading.
 * Never throws; missing data reads as null.
 */
export async function tapeFor(date: string): Promise<Tape> {
  let bullish: boolean | null = null;
  let breadth: number | null = null;
  try {
    const sql = getSql();
    const m = (await sql`
      SELECT payload->'market'->>'verdict' AS verdict FROM scan_results WHERE date <= ${date} ORDER BY date DESC LIMIT 1
    `) as { verdict: string | null }[];
    if (m[0]?.verdict) bullish = m[0].verdict === "bullish";
    const b = (await sql`
      SELECT pct_above_20::double precision AS p FROM research_breadth WHERE date <= ${date} ORDER BY date DESC LIMIT 1
    `) as { p: number | null }[];
    if (b[0]?.p !== null && b[0]?.p !== undefined) breadth = Number(b[0].p);
  } catch (err) {
    console.error("tapeFor failed:", err);
  }
  return { date, bullish, breadth, ...tapeMultiplier(bullish, breadth) };
}

/** The tape as of the latest scan — what the next fill would be sized on. */
export async function latestTape(): Promise<Tape> {
  try {
    const rows = (await getSql()`SELECT max(date)::text AS d FROM scan_results`) as { d: string | null }[];
    if (rows[0]?.d) return tapeFor(rows[0].d);
  } catch (err) {
    console.error("latestTape failed:", err);
  }
  return { date: "", bullish: null, breadth: null, ...tapeMultiplier(null, null) };
}
