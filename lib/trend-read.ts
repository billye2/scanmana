import { CONFIG } from "./config";
import { sma } from "./indicators";
import type { Bar } from "./types";

/**
 * The index trend in words (/tape, 1.9.8). Pure: daily bars in, sentences out,
 * the same tape always reading the same way. Each index gets one of seven states
 * from where its close sits against the 20- and 50-day, then the facts behind
 * it: distance to each average, their order and slope, how far off the high,
 * what the last bounce did and whether a recent low or high is being tested.
 * The verdict itself stays in lib/market.ts; this explains the tape around it
 * and names the next thing that has to happen. Nothing here decides a trade.
 */

const T = CONFIG.TREND;
const PERIODS: readonly number[] = CONFIG.MARKET.SMAS;

export type TrendState = "uptrend" | "recovering" | "pullback" | "repair" | "slipping" | "bounce" | "downtrend";
export type TrendTone = "up" | "mixed" | "down";

export interface AvgRead {
  period: number;
  value: number;
  /** Close over the average, as a fraction (−0.021 = 2.1% under). */
  dist: number;
  rising: boolean;
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
  state: TrendState;
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
  recovering: "Back over the 20- and 50-day, not yet confirmed",
  pullback: "Pullback under the 20-day",
  repair: "Repair under way",
  slipping: "Slipped under the 20- and 50-day",
  bounce: "Bounce inside a downtrend",
  downtrend: "Downtrend",
};
const TONE: Record<TrendState, TrendTone> = { uptrend: "up", recovering: "mixed", pullback: "mixed", repair: "mixed", slipping: "mixed", bounce: "down", downtrend: "down" };

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
  const avgs: AvgRead[] = PERIODS.map((period) => {
    const value = sma(bars, period)!;
    const then = sma(bars, period, CONFIG.MARKET.SLOPE_LOOKBACK)!;
    return { period, value, dist: last.c / value - 1, rising: value > then };
  });
  const a = (p: number) => avgs.find((x) => x.period === p)!;

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
    state: trendState(a(10).dist > 0, a(20).dist > 0, a(50).dist > 0, a(10).value > a(20).value, a(20).rising),
    high: { price: top.h, date: top.date, dist: last.c / top.h - 1, full: n >= T.HIGH_LOOKBACK },
    lowTest,
    highTest,
    bounce: readBounce(bars, lowIdx),
  };
}

function positionLine(t: IndexTrend): string {
  const each = t.avgs.map((x) => `${pc(x.dist)} ${x.dist > 0 ? "over" : "under"} the ${x.period}-day (${px(x.value)})`);
  const side = t.avgs.every((x) => x.dist > 0) ? "above all three averages" : t.avgs.every((x) => x.dist <= 0) ? "below all three averages" : "between its averages";
  const vol = t.volRatio === null ? "" : ` on ${times(t.volRatio)} its 20-day volume`;
  return `Closed ${px(t.close)} (${signed(t.change)})${vol}, ${side}: ${list(each)}.`;
}

function stackLine(t: IndexTrend): string {
  const [f, m, s] = t.avgs;
  const order =
    f.value > m.value && m.value > s.value ? "The averages are stacked 10 over 20 over 50"
    : f.value < m.value && m.value < s.value ? "The averages are stacked 10 under 20 under 50"
    : `The 10-day is ${f.value > m.value ? "over" : "under"} the 20-day and the 20-day is ${m.value > s.value ? "over" : "under"} the 50-day`;
  const up = t.avgs.filter((x) => x.rising).map((x) => `${x.period}-day`);
  const down = t.avgs.filter((x) => !x.rising).map((x) => `${x.period}-day`);
  const slope = down.length === 0 ? "all three rising" : up.length === 0 ? "all three falling" : `the ${list(up)} rising, the ${list(down)} falling`;
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

export function indexLines(t: IndexTrend): string[] {
  const out = [positionLine(t), stackLine(t), highLine(t)];
  if (t.bounce) out.push(bounceLine(t.bounce));
  if (t.lowTest) out.push(levelLine("low", t.lowTest));
  if (t.highTest && t.high.dist < -0.005) out.push(levelLine("high", t.highTest));
  return out;
}

/** The checks in the order a repair meets them. The 10-day close is the first sign, not part of the verdict. */
const LADDER: { say: string; ok: (t: IndexTrend) => boolean }[] = [
  { say: "a close back above the 10-day", ok: (t) => t.avgs[0].dist > 0 },
  { say: "the 10-day turning up", ok: (t) => t.avgs[0].rising },
  { say: "a close above the 20-day", ok: (t) => t.avgs[1].dist > 0 },
  { say: "the 10-day crossing over the 20-day", ok: (t) => t.avgs[0].value > t.avgs[1].value },
  { say: "the 20-day turning up", ok: (t) => t.avgs[1].rising },
  { say: "a close above the 50-day", ok: (t) => t.avgs[2].dist > 0 },
  { say: "the 50-day turning up", ok: (t) => t.avgs[2].rising },
];

export function nextLine(ts: IndexTrend[]): string {
  const open = LADDER.map((step) => ({ say: step.say, who: ts.filter((t) => !step.ok(t)).map((t) => t.ticker) })).filter((s) => s.who.length > 0);
  if (open.length === 0) return "Every check passes on both. The first warning would be a close under the 20-day.";
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
