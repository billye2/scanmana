import type { PathDay } from "./research";

/**
 * The follow-through card (/studies, 1.7.7) in words. Pure readers over one
 * group's path — the mean gain and mean running low per day of the trade — so
 * the page can say where the move peaks, what it is worth at the book's two
 * exit marks, and where the shake-out bottoms. Numbers from code, words from
 * one fixed template.
 */

export interface PathSummary {
  /** The day the mean gain is highest, and that gain. Null on an empty path. */
  peakDay: number | null;
  peakGain: number | null;
  /** Mean gain at each requested mark (missing marks are skipped). */
  marks: { day: number; gain: number }[];
  /** The day the mean running low is lowest, and that low. */
  troughDay: number | null;
  troughLow: number | null;
}

/** Days ascending by `day`. */
export function pathSummary(days: readonly PathDay[], marks: readonly number[]): PathSummary {
  if (days.length === 0) return { peakDay: null, peakGain: null, marks: [], troughDay: null, troughLow: null };
  let peak = days[0];
  let trough = days[0];
  for (const d of days) {
    if (d.mean > peak.mean) peak = d;
    if (d.low < trough.low) trough = d;
  }
  const at = marks
    .map((m) => days.find((d) => d.day === m))
    .filter((d): d is PathDay => d !== undefined)
    .map((d) => ({ day: d.day, gain: d.mean }));
  return { peakDay: peak.day, peakGain: peak.mean, marks: at, troughDay: trough.day, troughLow: trough.low };
}

const pc = (x: number) => `${x < 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(1)}%`;

/** One sentence under the chart. `label` names the group, `n` its rows. Pure. */
export function pathSentence(label: string, n: number, s: PathSummary): string {
  if (s.peakDay === null || s.peakGain === null || s.troughDay === null || s.troughLow === null) return "No complete paths yet — the outcomes job fills this over its next few runs.";
  const marks = s.marks.map((m) => `day ${m.day} ${pc(m.gain)}`).join(", ");
  return `${label} (${n.toLocaleString()} rows): the mean gain over the entry peaks on day ${s.peakDay} at ${pc(s.peakGain)}${marks ? ` — ${marks}` : ""}. The mean running low bottoms on day ${s.troughDay} at ${pc(s.troughLow)}.`;
}
