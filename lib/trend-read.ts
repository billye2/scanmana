import { CONFIG } from "./config";
import { sma } from "./indicators";
import type { Bar } from "./types";

/**
 * The index trend in words (/tape, 1.9.8). Pure: daily bars in, sentences out,
 * the same tape always reading the same way. Each index gets one of eight states
 * from where its close sits against the 20- and 50-day (seven of them), or a
 * range when those two averages are flat and close together, then the facts behind
 * it: distance to each average, their order and slope, how far off the high,
 * what the last bounce did and whether a recent low or high is being tested.
 * The verdict itself stays in lib/market.ts; this explains the tape around it
 * and names the next thing that has to happen. Nothing here decides a trade.
 *
 * Since 1.9.9 every side and slope has a dead zone (`latch`): replayed over 197
 * sessions the 1.9.8 state changed 57 times on SPY and 55 on QQQ, a median of
 * two sessions each, because a close 0.1% either side of an average renamed the
 * trend. With the zone and the range state it changes 32 times on each.
 */

const T = CONFIG.TREND;
const PERIODS: readonly number[] = CONFIG.MARKET.SMAS;

export type TrendState = "uptrend" | "range" | "recovering" | "pullback" | "repair" | "slipping" | "bounce" | "downtrend";
export type TrendTone = "up" | "mixed" | "down";

export interface AvgRead {
  period: number;
  value: number;
  /** Close over the average, as a fraction (−0.021 = 2.1% under). */
  dist: number;
  /** The side the close is on, latched: it changes only once the close is AT_PCT beyond the average. */
  above: boolean;
  /** True while the close is inside that zone: the wording says "at", the side above is the one it came from. */
  at: boolean;
  /** The average against itself SLOPE_LOOKBACK sessions ago, as a fraction. */
  change: number;
  /** The slope's direction, latched the same way with FLAT_SLOPE. */
  rising: boolean;
  /** True while the average has moved less than FLAT_SLOPE: the wording says "flat". */
  flat: boolean;
}

export interface RangeRead {
  high: number;
  highDate: string;
  low: number;
  lowDate: string;
  /** The 20-day over the 50-day, as a fraction. */
  gap: number;
}

export interface LevelTest {
  price: number;
  date: string;
  /** through = closed beyond it · rejected = traded beyond it and closed back · near = within NEAR_PCT of it. */
  result: "through" | "rejected" | "near";
}

export interface BounceRead {
  lowDate: string;
  peakDate: string;
  peakClose: number;
  /** True while tonight's close is the best close since the low. */
  running: boolean;
  /** Close over the low's low, as a fraction (running bounces). */
  gain: number;
  /** The shortest average the bounce never closed above; null when it cleared all three. */
  stalledUnder: number | null;
  /** The closest it came to that average, as a fraction under it. */
  shortBy: number | null;
  /** Mean of volume ÷ its 20-day average on the way up and on the way back; null with no sessions. */
  volUp: number | null;
  volDown: number | null;
}

export interface IndexTrend {
  ticker: string;
  date: string;
  close: number;
  change: number;
  /** Tonight's volume ÷ the prior 20-session average; null without volume. */
  volRatio: number | null;
  avgs: AvgRead[];
  /** The 10-day over the 20-day, latched with CROSS_PCT. */
  fastOverSlow: boolean;
  state: TrendState;
  /** Set when the state is "range": the high and low of the last RANGE_LOOKBACK sessions. */
  range: RangeRead | null;
  /** Highest high of the last HIGH_LOOKBACK sessions; `full` is false while the history is shorter than that. */
  high: { price: number; date: string; dist: number; full: boolean };
  lowTest: LevelTest | null;
  highTest: LevelTest | null;
  bounce: BounceRead | null;
}

export interface TrendRead {
  date: string;
  tone: TrendTone;
  headline: string;
  indices: { ticker: string; state: TrendState; lines: string[] }[];
  next: string;
}

const LABEL: Record<TrendState, string> = {
  uptrend: "Uptrend",
  range: "Range",
  recovering: "Back over the 20- and 50-day, not yet confirmed",
  pullback: "Pullback under the 20-day",
  repair: "Repair under way",
  slipping: "Slipped under the 20- and 50-day",
  bounce: "Bounce inside a downtrend",
  downtrend: "Downtrend",
};
const TONE: Record<TrendState, TrendTone> = { uptrend: "up", range: "mixed", recovering: "mixed", pullback: "mixed", repair: "mixed", slipping: "mixed", bounce: "down", downtrend: "down" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const px = (x: number) => x.toFixed(2);
const pc = (x: number) => `${(Math.abs(x) * 100).toFixed(1)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${pc(x)}`;
const times = (x: number) => `${x.toFixed(1)}×`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** SMA of closes ending at bar `i` (inclusive); null when there are not enough bars. */
const smaAt = (bars: Bar[], period: number, i: number) => sma(bars, period, bars.length - 1 - i);

/** Volume ÷ the mean of the `VOL_WINDOW` sessions before bar `i`; null without volume. */
function volRatioAt(bars: Bar[], i: number): number | null {
  if (i < T.VOL_WINDOW) return null;
  let sum = 0;
  for (let j = i - T.VOL_WINDOW; j < i; j++) sum += bars[j].v;
  return sum > 0 ? bars[i].v / (sum / T.VOL_WINDOW) : null;
}

function meanVol(bars: Bar[], from: number, to: number): number | null {
  const xs: number[] = [];
  for (let i = from; i <= to; i++) {
    const r = volRatioAt(bars, i);
    if (r !== null) xs.push(r);
  }
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

/**
 * Which side of zero a series is on, with a dead zone: the side changes only
 * once the value is more than `band` beyond zero, so a close that wobbles a few
 * tenths of a percent around an average does not rename the trend every night.
 * Walks bars `start`..`end`; the first value sets the side by its sign.
 */
export function latch(start: number, end: number, value: (i: number) => number | null, band: number): boolean {
  let side: boolean | null = null;
  for (let i = start; i <= end; i++) {
    const v = value(i);
    if (v === null) continue;
    if (side === null) side = v > 0;
    else if (v > band) side = true;
    else if (v < -band) side = false;
  }
  return side ?? false;
}

export function trendState(aboveFast: boolean, above20: boolean, above50: boolean, fastOverSlow: boolean, rising20: boolean): TrendState {
  if (above20 && above50) return fastOverSlow && rising20 ? "uptrend" : "recovering";
  if (above50) return "pullback";
  if (above20) return "repair";
  if (fastOverSlow) return "slipping"; // under both, but the 10-day has not crossed under the 20-day yet
  return aboveFast ? "bounce" : "downtrend";
}

/**
 * The bounce off the prior low, when that low was made under its 20-day: the
 * best close since, the first average it never closed above and how the volume
 * ran each way. Null when the low was yesterday or was not a low under the 20-day.
 */
function readBounce(bars: Bar[], lowIdx: number): BounceRead | null {
  const n = bars.length;
  const lowAvg = smaAt(bars, 20, lowIdx);
  if (lowIdx > n - 3 || lowAvg === null || bars[lowIdx].c >= lowAvg) return null;
  let peakIdx = lowIdx + 1;
  for (let i = lowIdx + 1; i < n; i++) if (bars[i].c > bars[peakIdx].c) peakIdx = i;
  const gain = bars[n - 1].c / bars[lowIdx].l - 1;
  const running = peakIdx === n - 1;
  if (bars[peakIdx].c / bars[lowIdx].l - 1 < T.MIN_BOUNCE) return null;

  let stalledUnder: number | null = null;
  let shortBy: number | null = null;
  for (const p of PERIODS) {
    let closest = Infinity;
    for (let i = lowIdx + 1; i <= peakIdx; i++) {
      const a = smaAt(bars, p, i);
      if (a !== null) closest = Math.min(closest, a / bars[i].c - 1);
    }
    if (closest > 0) {
      stalledUnder = p;
      shortBy = closest;
      break;
    }
  }
  return {
    lowDate: bars[lowIdx].date,
    peakDate: bars[peakIdx].date,
    peakClose: bars[peakIdx].c,
    running,
    gain,
    stalledUnder,
    shortBy,
    volUp: meanVol(bars, lowIdx + 1, peakIdx),
    volDown: running ? null : meanVol(bars, peakIdx + 1, n - 1),
  };
}

/** One index against its averages. Null without enough bars. Bars ascending by date. */
export function readIndexTrend(ticker: string, bars: Bar[]): IndexTrend | null {
  const n = bars.length;
  if (n < T.MIN_BARS) return null;
  const last = bars[n - 1];
  const back = CONFIG.MARKET.SLOPE_LOOKBACK;
  const start = Math.max(Math.max(...PERIODS) + back - 1, n - T.LATCH_LOOKBACK);
  const ratio = (x: number | null, y: number | null) => (x === null || y === null || y <= 0 ? null : x / y - 1);
  const avgs: AvgRead[] = PERIODS.map((period) => {
    const value = sma(bars, period)!;
    const dist = last.c / value - 1;
    const change = value / sma(bars, period, back)! - 1;
    return {
      period,
      value,
      dist,
      above: latch(start, n - 1, (i) => ratio(bars[i].c, smaAt(bars, period, i)), T.AT_PCT),
      at: Math.abs(dist) < T.AT_PCT,
      change,
      rising: latch(start, n - 1, (i) => ratio(smaAt(bars, period, i), smaAt(bars, period, i - back)), T.FLAT_SLOPE),
      flat: Math.abs(change) < T.FLAT_SLOPE,
    };
  });
  const a = (p: number) => avgs.find((x) => x.period === p)!;
  const fastOverSlow = latch(start, n - 1, (i) => ratio(smaAt(bars, 10, i), smaAt(bars, 20, i)), T.CROSS_PCT);

  // A range: the 20- and 50-day flat and close together, with the close still near the 20-day.
  // Scored as the worst of its four limits (1 = at the limit) and latched like the rest: it starts
  // once every limit is met and ends only when one is passed by RANGE_EXIT, so it does not flicker.
  const gap = a(20).value / a(50).value - 1;
  const rangeScore = (i: number): number | null => {
    const m = smaAt(bars, 20, i);
    const s = smaAt(bars, 50, i);
    const m0 = smaAt(bars, 20, i - back);
    const s0 = smaAt(bars, 50, i - back);
    if (m === null || s === null || m0 === null || s0 === null) return null;
    // A close beyond the prior sessions' high or low is the break that ends a range outright.
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = Math.max(0, i - T.RANGE_LOOKBACK); j < i; j++) {
      hi = Math.max(hi, bars[j].h);
      lo = Math.min(lo, bars[j].l);
    }
    if (bars[i].c > hi || bars[i].c < lo) return Infinity;
    return Math.max(Math.abs(m / s - 1) / T.RANGE_GAP, Math.abs(m / m0 - 1) / T.RANGE_SLOPE, Math.abs(s / s0 - 1) / T.RANGE_SLOPE, Math.abs(bars[i].c / m - 1) / T.RANGE_REACH);
  };
  const mid = (1 + T.RANGE_EXIT) / 2;
  const ranging = T.RANGE_GAP > 0 && latch(start, n - 1, (i) => { const x = rangeScore(i); return x === null ? null : mid - x; }, mid - 1);
  let range: RangeRead | null = null;
  if (ranging) {
    let hi = bars[n - 1];
    let lo = bars[n - 1];
    for (const b of bars.slice(-T.RANGE_LOOKBACK)) {
      if (b.h > hi.h) hi = b;
      if (b.l < lo.l) lo = b;
    }
    range = { high: hi.h, highDate: hi.date, low: lo.l, lowDate: lo.date, gap };
  }

  // The prior LEVEL_LOOKBACK sessions, tonight excluded: the low and the high being tested.
  let lowIdx = n - 2;
  let highIdx = n - 2;
  for (let i = n - 1 - T.LEVEL_LOOKBACK; i < n - 1; i++) {
    if (bars[i].l < bars[lowIdx].l) lowIdx = i;
    if (bars[i].h > bars[highIdx].h) highIdx = i;
  }
  const low = bars[lowIdx].l;
  const high = bars[highIdx].h;
  const lowTest: LevelTest | null =
    last.c < low ? { price: low, date: bars[lowIdx].date, result: "through" }
    : last.l < low ? { price: low, date: bars[lowIdx].date, result: "rejected" }
    : last.l <= low * (1 + T.NEAR_PCT) ? { price: low, date: bars[lowIdx].date, result: "near" }
    : null;
  const highTest: LevelTest | null =
    last.c > high ? { price: high, date: bars[highIdx].date, result: "through" }
    : last.h > high ? { price: high, date: bars[highIdx].date, result: "rejected" }
    : last.h >= high * (1 - T.NEAR_PCT) ? { price: high, date: bars[highIdx].date, result: "near" }
    : null;

  let top = bars[Math.max(0, n - T.HIGH_LOOKBACK)];
  for (const b of bars.slice(-T.HIGH_LOOKBACK)) if (b.h > top.h) top = b;

  return {
    ticker,
    date: last.date,
    close: last.c,
    change: last.c / bars[n - 2].c - 1,
    volRatio: volRatioAt(bars, n - 1),
    avgs,
    fastOverSlow,
    state: range ? "range" : trendState(a(10).above, a(20).above, a(50).above, fastOverSlow, a(20).rising),
    range,
    high: { price: top.h, date: top.date, dist: last.c / top.h - 1, full: n >= T.HIGH_LOOKBACK },
    lowTest,
    highTest,
    bounce: readBounce(bars, lowIdx),
  };
}

function positionLine(t: IndexTrend): string {
  const where = (x: AvgRead) => `${pc(x.dist)} ${x.dist > 0 ? "over" : "under"}`;
  const each = t.avgs.map((x) => (x.at ? `at the ${x.period}-day (${px(x.value)}, ${where(x)})` : `${where(x)} the ${x.period}-day (${px(x.value)})`));
  const on = t.avgs.filter((x) => x.at).map((x) => `${x.period}-day`);
  const side =
    on.length > 0 ? `sitting on its ${list(on)}`
    : t.avgs.every((x) => x.dist > 0) ? "above all three averages"
    : t.avgs.every((x) => x.dist <= 0) ? "below all three averages"
    : "between its averages";
  const vol = t.volRatio === null ? "" : ` on ${times(t.volRatio)} its 20-day volume`;
  return `Closed ${px(t.close)} (${signed(t.change)})${vol}, ${side}: ${list(each)}.`;
}

function stackLine(t: IndexTrend): string {
  const [f, m, s] = t.avgs;
  const order =
    f.value > m.value && m.value > s.value ? "The averages are stacked 10 over 20 over 50"
    : f.value < m.value && m.value < s.value ? "The averages are stacked 10 under 20 under 50"
    : `The 10-day is ${f.value > m.value ? "over" : "under"} the 20-day and the 20-day is ${m.value > s.value ? "over" : "under"} the 50-day`;
  const word = (x: AvgRead) => (x.flat ? "flat" : x.change > 0 ? "rising" : "falling");
  const groups = ["rising", "flat", "falling"].map((w) => ({ w, who: t.avgs.filter((x) => word(x) === w).map((x) => `${x.period}-day`) })).filter((g) => g.who.length > 0);
  const slope = groups.length === 1 ? `all three ${groups[0].w}` : groups.map((g) => `the ${list(g.who)} ${g.w}`).join(", ");
  return `${order}, ${slope}.`;
}

function highLine(t: IndexTrend): string {
  return t.high.dist >= -0.005 ? `At its ${t.high.full ? "52-week high" : "high of the stored history"} (${px(t.high.price)}, ${day(t.high.date)}).` : `${pc(t.high.dist)} off the ${day(t.high.date)} high (${px(t.high.price)}).`;
}

function bounceLine(b: BounceRead): string {
  if (b.running) return `Up ${pc(b.gain)} from the ${day(b.lowDate)} low, at its best close since.`;
  const reach =
    b.stalledUnder === null ? "it closed back over all three averages"
    : b.stalledUnder === PERIODS[0] ? `it never closed back over the ${b.stalledUnder}-day (${pc(b.shortBy!)} short)`
    : `it got back over the ${PERIODS[PERIODS.indexOf(b.stalledUnder) - 1]}-day and stalled ${pc(b.shortBy!)} under the ${b.stalledUnder}-day`;
  let vol = "";
  if (b.volUp !== null && b.volDown !== null) {
    const gap = b.volDown - b.volUp;
    const tag = gap >= T.VOL_GAP ? ", heavier on the way down" : gap <= -T.VOL_GAP ? ", heavier on the way up" : "";
    vol = ` Volume ran ${times(b.volUp)} average on the way up and ${times(b.volDown)} since${tag}.`;
  }
  return `The ${b.stalledUnder === null ? "rally" : "bounce"} off the ${day(b.lowDate)} low topped at ${px(b.peakClose)} on ${day(b.peakDate)}: ${reach}.${vol}`;
}

function levelLine(side: "low" | "high", x: LevelTest): string {
  const name = `the ${day(x.date)} ${side} (${px(x.price)})`;
  if (x.result === "through") return side === "low" ? `Closed below ${name}.` : `Closed above ${name}.`;
  if (x.result === "rejected") return side === "low" ? `Traded under ${name} and closed back above it.` : `Traded over ${name} and closed back under it.`;
  return `Within ${pc(T.NEAR_PCT)} of ${name}.`;
}

function rangeLine(r: RangeRead): string {
  return `The 20- and 50-day are flat and ${pc(r.gap)} apart, so this is a range: the last ${T.RANGE_LOOKBACK} sessions held between ${px(r.low)} (${day(r.lowDate)}) and ${px(r.high)} (${day(r.highDate)}).`;
}

export function indexLines(t: IndexTrend): string[] {
  const out = [positionLine(t), stackLine(t), highLine(t)];
  if (t.range) out.push(rangeLine(t.range));
  if (t.bounce) out.push(bounceLine(t.bounce));
  if (t.lowTest) out.push(levelLine("low", t.lowTest));
  if (t.highTest && t.high.dist < -0.005) out.push(levelLine("high", t.highTest));
  return out;
}

/** The checks in the order a repair meets them. The 10-day close is the first sign, not part of the verdict. */
const LADDER: { say: string; ok: (t: IndexTrend) => boolean }[] = [
  { say: "a close back above the 10-day", ok: (t) => t.avgs[0].above },
  { say: "the 10-day turning up", ok: (t) => t.avgs[0].rising },
  { say: "a close above the 20-day", ok: (t) => t.avgs[1].above },
  { say: "the 10-day crossing over the 20-day", ok: (t) => t.fastOverSlow },
  { say: "the 20-day turning up", ok: (t) => t.avgs[1].rising },
  { say: "a close above the 50-day", ok: (t) => t.avgs[2].above },
  { say: "the 50-day turning up", ok: (t) => t.avgs[2].rising },
];

export function nextLine(all: IndexTrend[]): string {
  // A range has no repair to wait for: the next thing is the close that leaves it.
  const ranging = all.filter((t) => t.range);
  const out = ranging.map((t) => `${t.ticker} is in a range until it closes above ${px(t.range!.high)} or below ${px(t.range!.low)}.`).join(" ");
  const ts = all.filter((t) => !t.range);
  if (ts.length === 0) return out;
  const rest = ladderLine(ts, all.length);
  return out ? `${out} ${rest}` : rest;
}

function ladderLine(ts: IndexTrend[], total: number): string {
  const both = ts.length === total && total > 1 ? "both" : list(ts.map((t) => t.ticker));
  const open = LADDER.map((step) => ({ say: step.say, who: ts.filter((t) => !step.ok(t)).map((t) => t.ticker) })).filter((s) => s.who.length > 0);
  if (open.length === 0) return `Every check passes on ${both}. The first warning would be a close under the 20-day.`;
  const [first, ...rest] = open;
  if (rest.length === 0 && first.say === LADDER[0].say) return `${list(first.who)} dipped under the 10-day; that alone does not flip the verdict. A close under the 20-day would.`;
  const then = rest.length ? ` Then: ${rest.map((s) => s.say).join(", ")}.` : "";
  return `Next to see: ${first.say} on ${list(first.who)}.${then}`;
}

function headline(ts: IndexTrend[]): string {
  if (ts.length === 1) return `${LABEL[ts[0].state]} on ${ts[0].ticker}`;
  const same = ts.every((t) => t.state === ts[0].state);
  const base = same ? `${LABEL[ts[0].state]} on both` : ts.map((t, i) => `${i === 0 ? LABEL[t.state] : LABEL[t.state].charAt(0).toLowerCase() + LABEL[t.state].slice(1)} on ${t.ticker}`).join(", ");
  const d50 = (t: IndexTrend) => t.avgs[2].dist;
  const [weak, strong] = [...ts].sort((x, y) => d50(x) - d50(y));
  if (d50(strong) - d50(weak) < T.LEAD_GAP) return base;
  const lead = d50(strong) <= 0 ? `${weak.ticker} the weaker of the two` : d50(weak) > 0 ? `${strong.ticker} leading` : `${strong.ticker} holding up better`;
  return `${base}, ${lead}`;
}

/** The whole read for the leaders. Null when no leader has enough bars. */
export function trendRead(barsByTicker: Map<string, Bar[]>): TrendRead | null {
  const ts: IndexTrend[] = [];
  for (const ticker of CONFIG.MARKET.LEADERS) {
    const bars = barsByTicker.get(ticker);
    const t = bars ? readIndexTrend(ticker, bars) : null;
    if (t) ts.push(t);
  }
  if (ts.length === 0) return null;
  const tones = ts.map((t) => TONE[t.state]);
  return {
    date: ts.map((t) => t.date).sort().at(-1)!,
    tone: tones.includes("down") ? "down" : tones.every((x) => x === "up") ? "up" : "mixed",
    headline: headline(ts),
    indices: ts.map((t) => ({ ticker: t.ticker, state: t.state, lines: indexLines(t) })),
    next: nextLine(ts),
  };
}
