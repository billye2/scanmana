import type { Verdict } from "./types";

// One palette for every verdict chip (deck button, deck list, analysis modal).
// Wait is white on solid green, Pass is red. There is no Take: EOD data can only say
// "watch this" or "skip this" — the entry decision belongs to tomorrow's open.
export const VERDICTS: Verdict[] = ["wait", "pass"];

const CHIP: Record<Verdict, string> = {
  wait: "bg-emerald-600 text-white",
  pass: "bg-red-900/70 text-red-200",
};
const LABEL: Record<Verdict, string> = { wait: "Wait", pass: "Pass" };
const NEUTRAL = "bg-neutral-800 text-neutral-300";

function known(v: string | undefined): v is Verdict {
  return v !== undefined && v in CHIP;
}
/** Tailwind classes for a verdict chip; neutral for missing/unknown (e.g. a "take" stored before it was removed). */
export function verdictChip(v: string | undefined): string {
  return known(v) ? CHIP[v] : NEUTRAL;
}
export function verdictLabel(v: string | undefined): string | null {
  return known(v) ? LABEL[v] : null;
}
