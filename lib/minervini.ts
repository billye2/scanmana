import { CONFIG } from "./config";
import type { ScreenCheck } from "./screen";
import type { Bar } from "./types";

export interface VcpRead {
  /** Pullback depths (fraction of the swing high), chronological. */
  contractions: number[];
  /** Highest high of the base window — the VCP pivot when no Darvas box exists. */
  baseHigh: number;
  /** Lowest low of the base window. */
  baseLow: number;
  /** True when each contraction is shallower than the one before it. */
  shrinking: boolean;
}

/**
 * Minervini Volatility Contraction Pattern, read deterministically from daily
 * bars: successive pullbacks (swing high → lowest low before the next swing
 * high), each expected to be shallower than the last, tightest at the right
 * edge. Pure geometry — the verdict and prose live in lib/analysis.ts.
 */
export function readVcp(bars: Bar[], opts = CONFIG.VCP): VcpRead | null {
  const win = bars.slice(-opts.BASE_LOOKBACK);
  if (win.length < opts.SWING_WIDTH * 2 + 1) return null;
  const w = opts.SWING_WIDTH;

  // Swing highs: bar whose high tops the `w` bars on each side.
  const swings: number[] = [];
  for (let i = w; i < win.length - w; i++) {
    let isSwing = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j !== i && win[j].h > win[i].h) { isSwing = false; break; }
    }
    if (isSwing) swings.push(i);
  }

  // One contraction per swing high: depth to the lowest low before the next swing (or the right edge).
  const contractions: number[] = [];
  for (let s = 0; s < swings.length; s++) {
    const from = swings[s];
    const to = s + 1 < swings.length ? swings[s + 1] : win.length;
    let low = Infinity;
    for (let i = from; i < to; i++) low = Math.min(low, win[i].l);
    const depth = 1 - low / win[from].h;
    if (depth > 0.005) contractions.push(depth); // ignore sub-half-percent noise
  }

  const shrinking =
    contractions.length >= opts.MIN_CONTRACTIONS &&
    contractions.every((d, i) => i === 0 || d < contractions[i - 1]);

  return {
    contractions,
    baseHigh: Math.max(...win.map((b) => b.h)),
    baseLow: Math.min(...win.map((b) => b.l)),
    shrinking,
  };
}

/**
 * The VCP conditions as a checklist for the symbol page's Scan fit panel.
 * Informational — VCP is an analysis lens, not one of the screen's hard filters.
 */
export function explainVcp(bars: Bar[]): ScreenCheck[] {
  const v = readVcp(bars);
  const pc = (n: number) => `${(n * 100).toFixed(0)}%`;
  if (!v || v.contractions.length === 0) {
    return [
      {
        label: `At least ${CONFIG.VCP.MIN_CONTRACTIONS} readable contractions in the last ${CONFIG.VCP.BASE_LOOKBACK} sessions`,
        ok: false,
        detail: "no pullback sequence found",
      },
    ];
  }
  const seq = v.contractions.map(pc).join(" → ");
  const final_ = v.contractions[v.contractions.length - 1];
  const last = bars[bars.length - 1];
  const vol5 = bars.slice(-5).reduce((s, b) => s + b.v, 0) / 5;
  const vol20 = bars.slice(-20).reduce((s, b) => s + b.v, 0) / 20;
  const ratio = vol20 > 0 ? vol5 / vol20 : null;
  return [
    {
      label: `At least ${CONFIG.VCP.MIN_CONTRACTIONS} readable contractions in the last ${CONFIG.VCP.BASE_LOOKBACK} sessions`,
      ok: v.contractions.length >= CONFIG.VCP.MIN_CONTRACTIONS,
      detail: `${v.contractions.length} found`,
    },
    { label: "Contractions progressively shallower (left to right)", ok: v.shrinking, detail: seq },
    { label: `Final contraction ≤ ${pc(CONFIG.VCP.MAX_FINAL_PCT)}`, ok: final_ <= CONFIG.VCP.MAX_FINAL_PCT, detail: `final ${pc(final_)}` },
    {
      label: `Volume drying up into the right edge (5-day < ${CONFIG.ANALYSIS.VOL_DRYUP}× the 20-day)`,
      ok: ratio !== null && ratio < CONFIG.ANALYSIS.VOL_DRYUP,
      detail: ratio === null ? "no volume data" : `5-day is ${ratio.toFixed(1)}× the 20-day`,
    },
    { label: "Holding above the base low", ok: last.c >= v.baseLow, detail: `close $${last.c.toFixed(2)} vs base low $${v.baseLow.toFixed(2)}` },
  ];
}
