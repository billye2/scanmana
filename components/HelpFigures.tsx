import { CONFIG } from "../lib/config";
import { type FigBar, type Frame, barsFromCloses, candleX, priceScale, rollingMean, slotWidth } from "../lib/figure-scale";

/**
 * Drawn diagrams for /help (1.9.6): schematic charts that sit between the page's
 * paragraphs. Server components, plain SVG, no hooks and no data, so the page
 * stays static and a figure never goes stale the way a screenshot does.
 *
 * Sizing rule: every viewBox is about 340 wide and the figure is capped at
 * max-w-md, so on a phone the drawing renders near 1:1 and its 10px labels stay
 * readable (the 520-wide study charts shrink their labels on a phone; these must
 * not). Words inside a drawing are short labels only: the caption and legend are
 * HTML in text-[11px], which the gear's Text size setting scales (globals.css).
 *
 * The colours are the real chart's (components/Chart.tsx), so a line here looks
 * like the line it explains. The candles are made up: closes written by hand,
 * turned into bars by lib/figure-scale.ts.
 */

const UP = "#34d399";
const DOWN = "#f87171";
const AMBER = "#f59e0b";
const PIVOT = "#60a5fa";
const MA_FAST = "#60a5fa";
const MA_SLOW = "#c084fc";
const INK = "#a3a3a3";
const DIM = "#737373";
const MARK = "#e5e7eb";
const W = 340;

function Figure({ label, caption, legend, children }: { label: string; caption: React.ReactNode; legend?: { color: string; text: string; dashed?: boolean }[]; children: React.ReactNode }) {
  return (
    <figure className="my-3 max-w-md rounded-xl bg-neutral-900 p-3">
      <div role="img" aria-label={label}>{children}</div>
      {legend && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-400">
          {legend.map((l) => (
            <span key={l.text} className="inline-flex items-center gap-1">
              <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? "4 3" : undefined} /></svg>
              {l.text}
            </span>
          ))}
        </div>
      )}
      <figcaption className="mt-2 text-[11px] leading-relaxed text-neutral-500">{caption}</figcaption>
    </figure>
  );
}

function Candles({ bars, frame, y, slots = bars.length }: { bars: readonly FigBar[]; frame: Frame; y: (p: number) => number; slots?: number }) {
  const body = Math.max(2, Math.min(9, slotWidth(slots, frame) * 0.62));
  return (
    <g>
      {bars.map(([o, h, l, c], i) => {
        const x = candleX(i, slots, frame);
        const color = c >= o ? UP : DOWN;
        const top = y(Math.max(o, c));
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(h)} y2={y(l)} stroke={color} strokeWidth="1" />
            <rect x={x - body / 2} y={top} width={body} height={Math.max(1, y(Math.min(o, c)) - top)} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

/** A moving-average line over the drawn bars; `lead` are closes before the first bar so the line starts at the left edge. */
function MaLine({ closes, lead, period, color, frame, y, slots = closes.length }: { closes: readonly number[]; lead: readonly number[]; period: number; color: string; frame: Frame; y: (p: number) => number; slots?: number }) {
  const means = rollingMean([...lead, ...closes], period).slice(lead.length);
  // An average still catching up from before the chart runs off the bottom edge, where the svg clips it.
  const pts = means.flatMap((m, i) => (m === null ? [] : [`${candleX(i, slots, frame).toFixed(1)},${y(m).toFixed(1)}`]));
  return <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.25" />;
}

const T = ({ x, y, fill = INK, anchor = "start", children }: { x: number; y: number; fill?: string; anchor?: "start" | "middle" | "end"; children: React.ReactNode }) => (
  <text x={x} y={y} fontSize="10" fill={fill} textAnchor={anchor}>{children}</text>
);

/* ---------- 1. The chart lines on one chart ---------- */

// A run to an old high, a pullback, a rally that stops short of it, then the box under that lower ceiling.
const ANATOMY_LEAD = [21.5, 21.8, 22, 21.9, 22.1, 22, 22.2, 22.1, 22.3, 22.2, 22.4, 22.3, 22.6, 23.4, 24.1, 25.3, 26.8, 28.2, 30, 31.6];
const ANATOMY_CLOSES = [
  33.5, 34.6, 36, 37.1, 38, 39.3, 40.2, 41.2, // the end of the run
  39.6, 38.1, 36.6, 35.6, 36.2, // the pullback
  37.6, 38.6, 39, // the rally: its high becomes the box top
  38.2, 37.4, 37.9, 38.4, 37.6, 37.3, 37.8, 38.3, 38.6, 38.1, 38.5, 38.7, // the box
];
const ANATOMY_PEAK = 7;
const ANATOMY_TOP = 15;
const ANATOMY_BARS = barsFromCloses(ANATOMY_CLOSES, { [ANATOMY_PEAK]: { h: 42 }, [ANATOMY_TOP]: { h: 39.6 } });

export function ChartAnatomy() {
  const frame: Frame = { left: 4, right: 286, top: 10, bottom: 168 };
  const bars = ANATOMY_BARS;
  const y = priceScale(bars, frame);
  const top = bars[ANATOMY_TOP][1];
  const bottom = Math.min(...bars.slice(ANATOMY_TOP).map((b) => b[2]));
  const pivot = bars[ANATOMY_PEAK][1];
  const boxX = candleX(ANATOMY_TOP, bars.length, frame);
  const pivotX = candleX(ANATOMY_PEAK, bars.length, frame);
  return (
    <Figure
      label="A made-up chart with the card's lines drawn on it: trigger, stop, pivot and the two moving averages"
      legend={[
        { color: MA_FAST, text: `${CONFIG.SMA_FAST}-day average` },
        { color: MA_SLOW, text: `${CONFIG.SMA_SLOW}-day average` },
      ]}
      caption={
        <>
          The lines a card draws, on a made-up chart. The stock ran, pulled back, and then rested under a ceiling: that ceiling is the
          trigger and the lowest low since is the stop, and the shaded band between them is the box. The pivot is the older, higher swing
          high; it is drawn only when it differs from the trigger, as here.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 178`} className="block w-full">
        <rect x={boxX} y={y(top)} width={frame.right - boxX} height={y(bottom) - y(top)} fill={AMBER} opacity="0.08" />
        <MaLine closes={ANATOMY_CLOSES} lead={ANATOMY_LEAD} period={CONFIG.SMA_SLOW} color={MA_SLOW} frame={frame} y={y} />
        <MaLine closes={ANATOMY_CLOSES} lead={ANATOMY_LEAD} period={CONFIG.SMA_FAST} color={MA_FAST} frame={frame} y={y} />
        <Candles bars={bars} frame={frame} y={y} />
        <line x1={pivotX} x2={frame.right} y1={y(pivot)} y2={y(pivot)} stroke={PIVOT} strokeWidth="1.25" strokeDasharray="1.5 3" />
        <line x1={boxX} x2={frame.right} y1={y(top)} y2={y(top)} stroke={AMBER} strokeWidth="1.5" />
        <line x1={boxX} x2={frame.right} y1={y(bottom)} y2={y(bottom)} stroke={AMBER} strokeWidth="1.5" strokeDasharray="5 3" />
        <T x={frame.right + 5} y={y(pivot) + 3.5} fill={PIVOT}>pivot</T>
        <T x={frame.right + 5} y={y(top) + 3.5} fill={AMBER}>trigger</T>
        <T x={frame.right + 5} y={y(bottom) + 3.5} fill={AMBER}>stop</T>
      </svg>
    </Figure>
  );
}

/* ---------- 2. "no box" ---------- */

const FRESH_BARS = barsFromCloses([30, 30.9, 31.5, 32.6, 33.4, 34.8, 35.5, 36.9, 38, 39.4, 40.3, 41.8, 43, 44.4]);
const TALL_BARS = barsFromCloses([43.5, 41, 38, 34.5, 31, 29.5, 32, 35.5, 39, 41.5, 38.5, 34.5, 31.5, 33.5]);

export function NoBox() {
  const panels = [
    { title: "Fresh highs", bars: FRESH_BARS, frame: { left: 4, right: 162, top: 22, bottom: 104 }, note: "no ceiling has held yet" },
    { title: "Range too tall", bars: TALL_BARS, frame: { left: 178, right: 336, top: 22, bottom: 104 }, note: "" },
  ];
  const hi = Math.max(...TALL_BARS.map((b) => b[1]));
  const lo = Math.min(...TALL_BARS.map((b) => b[2]));
  panels[1].note = `${Math.round(((hi - lo) / hi) * 100)}% from top to bottom`;
  return (
    <Figure
      label="Two made-up charts with no box: one making fresh highs, one swinging in a range too tall to trade"
      caption={
        <>
          The two ways a card reads &ldquo;no box&rdquo;. Left: every few sessions make a new high, so no ceiling has held for{" "}
          {CONFIG.DARVAS.confirm} sessions. Right: a ceiling exists, but the range under it is taller than{" "}
          {CONFIG.DARVAS.maxHeightPct * 100}%, too loose for a stop at its bottom.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 122`} className="block w-full">
        {panels.map((p) => {
          const y = priceScale(p.bars, p.frame);
          const mid = (p.frame.left + p.frame.right) / 2;
          return (
            <g key={p.title}>
              <T x={mid} y={12} fill={MARK} anchor="middle">{p.title}</T>
              <Candles bars={p.bars} frame={p.frame} y={y} />
              <T x={mid} y={118} fill={DIM} anchor="middle">{p.note}</T>
            </g>
          );
        })}
        <line x1={170} x2={170} y1={6} y2={116} stroke="#262626" strokeWidth="1" />
      </svg>
    </Figure>
  );
}

/* ---------- 3. What arms, and when ---------- */

const ARM_TOP = 39.3;
const ARM_BOTTOM = 37;
const ARM_BASE = [38.2, 37.6, 38, 38.5, 37.8, 38.3];
const ARM_SLOTS = 10;
const ARM_PANELS = [
  { title: "Inside the box", status: "waits", tone: INK, closes: [...ARM_BASE, 38.6, 38.2, 38.7] },
  { title: "First close above", status: "arms tonight", tone: UP, closes: [...ARM_BASE, 38.6, 38.4, 40.2] },
  { title: "Broke out earlier", status: "not armed", tone: DOWN, closes: [...ARM_BASE.slice(0, 5), 40.1, 40.9, 41.5, 42.2] },
];

export function WhatArms() {
  const all = ARM_PANELS.flatMap((p) => barsFromCloses(p.closes));
  const span = { top: 24, bottom: 112 };
  const y = priceScale(all, span, [ARM_BOTTOM - 0.3]);
  return (
    <Figure
      label="Three made-up charts of the same box: a close inside it, the first close above it, and a breakout that is several sessions old"
      caption={
        <>
          The same box on three nights. A close inside it arms nothing. The first close above the trigger arms one order: buy at the next
          open (the dot), with the stop at that day&apos;s low (the red line). A card already above its box for several sessions is not
          bought.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 136`} className="block w-full">
        {ARM_PANELS.map((p, k) => {
          const frame: Frame = { left: 4 + k * 114, right: 104 + k * 114, ...span };
          const bars = barsFromCloses(p.closes);
          const mid = (frame.left + frame.right) / 2;
          const last = bars[bars.length - 1];
          return (
            <g key={p.title}>
              <T x={mid} y={12} fill={MARK} anchor="middle">{p.title}</T>
              <rect x={frame.left} y={y(ARM_TOP)} width={frame.right - frame.left} height={y(ARM_BOTTOM) - y(ARM_TOP)} fill={AMBER} opacity="0.08" />
              <line x1={frame.left} x2={frame.right} y1={y(ARM_TOP)} y2={y(ARM_TOP)} stroke={AMBER} strokeWidth="1.5" />
              <line x1={frame.left} x2={frame.right} y1={y(ARM_BOTTOM)} y2={y(ARM_BOTTOM)} stroke={AMBER} strokeWidth="1.5" strokeDasharray="5 3" />
              <Candles bars={bars} frame={frame} y={y} slots={ARM_SLOTS} />
              {k === 1 && (
                <>
                  <line x1={candleX(bars.length - 1, ARM_SLOTS, frame) - 5} x2={frame.right} y1={y(last[2])} y2={y(last[2])} stroke={DOWN} strokeWidth="1.25" strokeDasharray="3 2" />
                  <circle cx={candleX(bars.length, ARM_SLOTS, frame)} cy={y(last[3] * 1.004)} r="3" fill={MARK} />
                </>
              )}
              <T x={mid} y={130} fill={p.tone} anchor="middle">{p.status}</T>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}

/* ---------- 4. The Auto ledger's routine on one trade ---------- */

const PLAY_LEAD = [37.2, 37.6, 37.9, 38.1, 37.8, 38.3];
const PLAY_BOX = [38.2, 38.5, 38.1, 38.6];
const PLAY_TOP = 39.3;
// The breakout day, then the trade: day 1 is the first entry in PLAY_TRADE.
const PLAY_BREAK = 40.2;
const PLAY_TRADE = [41.3, 42, 43.1, 44, 45.2, 46.5, 47.1, 46.6, 47.8, 47.2, 44.7, 44.2];

export function Playbook() {
  const { PARTIAL_DAY, MA } = CONFIG.PAPER.KULLAMAGI;
  const closes = [...PLAY_BOX, PLAY_BREAK, ...PLAY_TRADE];
  const b = PLAY_BOX.length; // index of the breakout day
  const entryOpen = PLAY_BREAK * 1.005;
  const bars = barsFromCloses(closes, { [b]: { l: 38.4 }, [b + 1]: { o: entryOpen } });
  const stop = bars[b][2];
  const frame: Frame = { left: 4, right: 298, top: 12, bottom: 146 };
  const y = priceScale(bars, frame, [stop - 0.4]);
  const x = (i: number) => candleX(i, bars.length, frame);
  const means = rollingMean([...PLAY_LEAD, ...closes], MA).slice(PLAY_LEAD.length);
  // The first close under the average after the entry; the rest is sold at the next open.
  const under = closes.findIndex((c, i) => i > b && means[i] !== null && c < means[i]!);
  const sell = under >= 0 && under + 1 < bars.length ? under + 1 : -1;
  const shown = sell >= 0 ? bars.slice(0, sell + 1) : bars;
  const half = b + PARTIAL_DAY;
  const lastMean = means[shown.length - 1];
  return (
    <Figure
      label="One made-up trade under the Auto ledger's routine: the breakout day, the buy at the next open, half sold on a later day, and the exit after a close under the average"
      legend={[
        { color: DOWN, text: "first stop: the breakout day's low", dashed: true },
        { color: UP, text: "stop at the entry after the half", dashed: true },
        { color: MA_FAST, text: `${MA}-day average` },
      ]}
      caption={
        <>
          The Auto ledger&apos;s whole routine on one made-up trade. The close above the trigger is the breakout day. Day 1 buys the open,
          with the stop at the breakout day&apos;s low. On day {PARTIAL_DAY}, with the trade up, half is sold at the open and the stop moves
          to the entry. The first close under the {MA}-day average sells the rest at the next open.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 186`} className="block w-full">
        <line x1={frame.left} x2={x(b) + 6} y1={y(PLAY_TOP)} y2={y(PLAY_TOP)} stroke={AMBER} strokeWidth="1.5" />
        <T x={frame.left + 2} y={y(PLAY_TOP) - 5} fill={AMBER}>trigger</T>
        <polyline
          points={means.slice(0, shown.length).flatMap((m, i) => (m === null ? [] : [`${x(i).toFixed(1)},${y(m).toFixed(1)}`])).join(" ")}
          fill="none" stroke={MA_FAST} strokeWidth="1.25"
        />
        <line x1={x(b)} x2={x(half)} y1={y(stop)} y2={y(stop)} stroke={DOWN} strokeWidth="1.25" strokeDasharray="3 2" />
        <line x1={x(half)} x2={x(shown.length - 1)} y1={y(entryOpen)} y2={y(entryOpen)} stroke={UP} strokeWidth="1.25" strokeDasharray="3 2" />
        <Candles bars={shown} frame={frame} y={y} slots={bars.length} />
        <circle cx={x(b + 1)} cy={y(bars[b + 1][0])} r="3" fill={MARK} />
        <circle cx={x(half)} cy={y(bars[half][0])} r="3" fill={MARK} />
        {sell >= 0 && <circle cx={x(sell)} cy={y(bars[sell][0])} r="3" fill={MARK} />}
        {lastMean != null && <T x={x(shown.length - 1) + 8} y={y(lastMean) + 3.5} fill={MA_FAST}>{MA}-day</T>}
        <T x={x(b) + 4} y={160} anchor="end">break</T>
        <T x={x(b + 1) - 4} y={160} fill={MARK}>buy</T>
        <T x={x(half)} y={160} fill={MARK} anchor="middle">half off</T>
        {sell >= 0 && <T x={x(sell)} y={160} fill={MARK} anchor="middle">sell rest</T>}
        <T x={x(b + 1) - 4} y={176} fill={DIM}>day 1</T>
        <T x={x(half)} y={176} fill={DIM} anchor="middle">day {PARTIAL_DAY}</T>
        {sell >= 0 && <T x={x(sell)} y={176} fill={DIM} anchor="middle">day {sell - b}</T>}
      </svg>
    </Figure>
  );
}

/* ====================================================================
 * Second pass (1.9.7): the badges, the market rule, the shadow rule,
 * fills, tape size, R, the range bar and the drill's three outcomes.
 * ==================================================================== */

const TWO_UP: [Frame, Frame] = [
  { left: 4, right: 162, top: 24, bottom: 104 },
  { left: 178, right: 336, top: 24, bottom: 104 },
];
const threeUp = (k: number, top = 24, bottom = 112): Frame => ({ left: 4 + k * 114, right: 104 + k * 114, top, bottom });
const Divider = ({ x, h }: { x: number; h: number }) => <line x1={x} x2={x} y1={6} y2={h} stroke="#262626" strokeWidth="1" />;

/** Bars with the same wick on every bar, so two panels share one average daily range. */
function evenBars(closes: readonly number[], wick: number): FigBar[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c - 0.3 : closes[i - 1];
    return [o, Math.max(o, c) + wick, Math.min(o, c) - wick, c] as const;
  });
}

/* ---------- tight ---------- */

const LOOSE_BARS = evenBars([36, 37.6, 36.8, 38.9, 38, 40.2, 39.4, 41.5, 42.8, 44], 0.75);
const TIGHT_BARS = evenBars([42, 42.6, 41.8, 42.5, 41.9, 42.7, 42, 42.6, 41.9, 42.4], 0.9);

/** Range of the bars over their average daily range: the card's "tight" number on made-up bars. */
function tightRatio(bars: readonly FigBar[]): number {
  const span = Math.max(...bars.map((b) => b[1])) / Math.min(...bars.map((b) => b[2])) - 1;
  const adr = bars.reduce((s, b) => s + (b[1] / b[2] - 1), 0) / bars.length;
  return span / adr;
}

export function Tightness() {
  const panels = [
    { title: "Loose", bars: LOOSE_BARS, frame: TWO_UP[0] },
    { title: "Tight", bars: TIGHT_BARS, frame: TWO_UP[1] },
  ];
  const y = priceScale([...LOOSE_BARS, ...TIGHT_BARS], TWO_UP[0]);
  return (
    <Figure
      label="Two made-up ten-day stretches with the same daily range: one wandering across a wide span, one sitting in a narrow one"
      caption={
        <>
          The same size of daily bar in both. On the left the {CONFIG.TIGHTNESS_WINDOW} days wander, so together they span several days&apos;
          worth of movement. On the right they sit on top of each other. The shaded band is the {CONFIG.TIGHTNESS_WINDOW}-day range; the
          number is that range divided by one average day.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 122`} className="block w-full">
        {panels.map((p) => {
          const hi = Math.max(...p.bars.map((b) => b[1]));
          const lo = Math.min(...p.bars.map((b) => b[2]));
          const mid = (p.frame.left + p.frame.right) / 2;
          return (
            <g key={p.title}>
              <T x={mid} y={12} fill={MARK} anchor="middle">{p.title}</T>
              <rect x={p.frame.left} y={y(hi)} width={p.frame.right - p.frame.left} height={y(lo) - y(hi)} fill={AMBER} opacity="0.1" />
              <Candles bars={p.bars} frame={p.frame} y={y} />
              <T x={mid} y={118} fill={DIM} anchor="middle">tight {tightRatio(p.bars).toFixed(1)}</T>
            </g>
          );
        })}
        <Divider x={170} h={116} />
      </svg>
    </Figure>
  );
}

/* ---------- EP ---------- */

const EP_CLOSES = [20, 20.3, 19.9, 20.2, 20.4, 20.1, 20.3, 20, 20.2, 20.4, 20.1, 20.3, 24.6, 24.9, 24.4, 25.2];
const EP_GAP = 12;
const EP_VOLUME = [1, 0.9, 1.1, 1, 0.8, 1, 1.2, 0.9, 1, 1.1, 0.9, 1, 5.2, 2.6, 1.9, 1.7];
const EP_BARS = barsFromCloses(EP_CLOSES, { [EP_GAP]: { o: 23.3, l: 23.1 } });

export function EpGap() {
  const frame: Frame = { left: 4, right: 336, top: 12, bottom: 96 };
  const y = priceScale(EP_BARS, frame);
  const x = (i: number) => candleX(i, EP_BARS.length, frame);
  const gapPct = Math.round((EP_BARS[EP_GAP][0] / EP_CLOSES[EP_GAP - 1] - 1) * 100);
  const vTop = 106;
  const vBottom = 134;
  const vMax = Math.max(...EP_VOLUME);
  const bw = slotWidth(EP_BARS.length, frame) * 0.62;
  return (
    <Figure
      label="A made-up chart of an episodic pivot: a flat stretch, then one day that opens far above the last close on several times the usual volume"
      caption={
        <>
          An episodic pivot: weeks of nothing, then a day that opens at least {CONFIG.EP.MIN_GAP * 100}% over the last close on{" "}
          {CONFIG.EP.VOL_MULT}× the usual volume or more. The bars under the chart are volume. The badge marks a card with such a day in its
          last {CONFIG.EP.LOOKBACK} sessions.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 138`} className="block w-full">
        <Candles bars={EP_BARS} frame={frame} y={y} />
        <line x1={x(EP_GAP) - 12} x2={x(EP_GAP) - 12} y1={y(EP_BARS[EP_GAP][0])} y2={y(EP_CLOSES[EP_GAP - 1])} stroke={INK} strokeWidth="1" />
        <T x={x(EP_GAP) - 17} y={(y(EP_BARS[EP_GAP][0]) + y(EP_CLOSES[EP_GAP - 1])) / 2 + 3} anchor="end">gap +{gapPct}%</T>
        {EP_VOLUME.map((v, i) => (
          <rect key={i} x={x(i) - bw / 2} y={vBottom - (v / vMax) * (vBottom - vTop)} width={bw} height={(v / vMax) * (vBottom - vTop)} fill={i === EP_GAP ? AMBER : "#404040"} />
        ))}
        <T x={x(EP_GAP) - 17} y={vTop + 8} fill={AMBER} anchor="end">{EP_VOLUME[EP_GAP].toFixed(0)}× volume</T>
      </svg>
    </Figure>
  );
}

/* ---------- the market rule ---------- */

const wiggle = [0, 0.7, -0.4, 0.5];
const MKT_LEAD = Array.from({ length: 20 }, (_, i) => 82 + i * 0.9 + wiggle[i % 4]);
const MKT_UP = Array.from({ length: 22 }, (_, i) => 100 + i * 0.9 + wiggle[i % 4]);
const MKT_DOWN = [
  ...Array.from({ length: 9 }, (_, i) => 100 + i * 0.9 + wiggle[i % 4]),
  ...Array.from({ length: 13 }, (_, i) => 107.5 - i * 1.05 + wiggle[i % 4]),
];

export function MarketRule() {
  const panels = [
    { title: `${CONFIG.SMA_FAST}-day above ${CONFIG.SMA_SLOW}-day`, status: "breakouts work", tone: UP, closes: MKT_UP, frame: TWO_UP[0] },
    { title: `${CONFIG.SMA_FAST}-day under ${CONFIG.SMA_SLOW}-day`, status: "step aside", tone: DOWN, closes: MKT_DOWN, frame: TWO_UP[1] },
  ];
  return (
    <Figure
      label="Two made-up index charts: one rising with its fast average above its slow average, one rolling over with the fast average crossing under"
      legend={[
        { color: MA_FAST, text: `${CONFIG.SMA_FAST}-day average` },
        { color: MA_SLOW, text: `${CONFIG.SMA_SLOW}-day average` },
      ]}
      caption={
        <>
          His first rule on a made-up index. While the {CONFIG.SMA_FAST}-day average is above the {CONFIG.SMA_SLOW}-day, breakouts work.
          Once it crosses under, they fail until it crosses back. Bullish on the strip asks for more than the cross: price above the
          20- and 50-day, and all three averages rising, on both indexes.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 122`} className="block w-full">
        {panels.map((p) => {
          const bars = barsFromCloses(p.closes);
          // The slow average lags under the candles: give it room so it does not run into the status line.
          const slow = rollingMean([...MKT_LEAD, ...p.closes], CONFIG.SMA_SLOW).slice(MKT_LEAD.length).filter((m): m is number => m !== null);
          const y = priceScale(bars, p.frame, slow);
          const mid = (p.frame.left + p.frame.right) / 2;
          return (
            <g key={p.title}>
              <T x={mid} y={12} fill={MARK} anchor="middle">{p.title}</T>
              <Candles bars={bars} frame={p.frame} y={y} />
              <MaLine closes={p.closes} lead={MKT_LEAD} period={CONFIG.SMA_SLOW} color={MA_SLOW} frame={p.frame} y={y} />
              <MaLine closes={p.closes} lead={MKT_LEAD} period={CONFIG.SMA_FAST} color={MA_FAST} frame={p.frame} y={y} />
              <T x={mid} y={118} fill={p.tone} anchor="middle">{p.status}</T>
            </g>
          );
        })}
        <Divider x={170} h={116} />
      </svg>
    </Figure>
  );
}

/* ---------- the shadow rule ---------- */

const SHADOW_KEEP = barsFromCloses([30, 31.5, 33, 34.6, 36.2, 37.6, 38.4, 37.6, 37.1, 37.7, 38, 37.4, 37.8, 38.1, 37.7, 38.2, 39.9], { 6: { h: 39 } });
const SHADOW_KEEP_TOP = 6;
const SHADOW_DROP = barsFromCloses([34, 36, 38, 40.2, 41.5, 40, 38.2, 36.8, 36, 37, 37.9, 37.3, 36.9, 37.4, 37.7, 37.2, 37.6, 39.5], { 4: { h: 42.2 }, 10: { h: 38.4 } });
const SHADOW_DROP_HIGH = 4;
const SHADOW_DROP_TOP = 10;

export function ShadowRule({ window }: { window: number }) {
  const frames = TWO_UP.map((f) => ({ ...f, top: 40, bottom: 116 }));
  const y = priceScale([...SHADOW_KEEP, ...SHADOW_DROP], frames[0]);
  const panels = [
    { title: "Clears the whole range", status: "shadow keeps", tone: UP, bars: SHADOW_KEEP, frame: frames[0], top: SHADOW_KEEP_TOP, high: -1 },
    { title: "Breaks a lower high", status: "shadow drops", tone: DOWN, bars: SHADOW_DROP, frame: frames[1], top: SHADOW_DROP_TOP, high: SHADOW_DROP_HIGH },
  ];
  return (
    <Figure
      label="Two made-up breakouts: one where the box top is the highest high on the chart, one where an older, higher high sits above the box"
      caption={
        <>
          Both close above the trigger, so the live rule arms both. On the left the box top is also the highest high of the last {window}{" "}
          sessions, so the close clears everything. On the right an older high sits above the box: the close breaks a lower high and is
          still under the range&apos;s top. The shadow rule keeps the first and drops the second.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 134`} className="block w-full">
        {panels.map((p) => {
          const n = p.bars.length;
          const mid = (p.frame.left + p.frame.right) / 2;
          const top = p.bars[p.top][1];
          return (
            <g key={p.title}>
              <T x={mid} y={12} fill={MARK} anchor="middle">{p.title}</T>
              {p.high >= 0 && (
                <>
                  <line x1={candleX(p.high, n, p.frame)} x2={p.frame.right} y1={y(p.bars[p.high][1])} y2={y(p.bars[p.high][1])} stroke={INK} strokeWidth="1.25" strokeDasharray="1.5 3" />
                  <T x={p.frame.right} y={y(p.bars[p.high][1]) - 5} anchor="end">{window}-session high</T>
                </>
              )}
              <line x1={candleX(p.top, n, p.frame)} x2={p.frame.right} y1={y(top)} y2={y(top)} stroke={AMBER} strokeWidth="1.5" />
              <Candles bars={p.bars} frame={p.frame} y={y} />
              <T x={mid} y={130} fill={p.tone} anchor="middle">{p.status}</T>
            </g>
          );
        })}
        <Divider x={170} h={128} />
      </svg>
    </Figure>
  );
}

/* ---------- how fills work ---------- */

const FILL_SLOTS = 6;
const FILL_PANELS = [
  { title: "High reaches it", status: "fills at the trigger", level: 39, stop: false, at: 3, bars: barsFromCloses([38, 38.4, 38.1, 39.7, 40.1]), price: (b: FigBar) => Math.min(39, b[1]) },
  { title: "Opens above it", status: "fills at the open", level: 39, stop: false, at: 3, bars: barsFromCloses([38, 38.4, 38.1, 40.5, 40.9], { 3: { o: 39.9 } }), price: (b: FigBar) => b[0] },
  { title: "Low hits the stop", status: "sells at the stop", level: 37.5, stop: true, at: 3, bars: barsFromCloses([39.2, 39.6, 38.9, 37, 36.7]), price: () => 37.5 },
];

export function Fills() {
  return (
    <Figure
      label="Three made-up fills: a bar whose high reaches the trigger, a bar that opens above the trigger, and a bar whose low hits the stop"
      caption={
        <>
          Where the book books a price (the dot). A buy-stop fills at the trigger on the first bar whose high reaches it, or at the open
          when the stock gapped past it. A stop sells at the stop when a low touches it, or at the open when the stock gapped under.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 136`} className="block w-full">
        {FILL_PANELS.map((p, k) => {
          const frame = threeUp(k);
          const y = priceScale(p.bars, frame, [p.level]);
          const mid = (frame.left + frame.right) / 2;
          return (
            <g key={p.title}>
              <T x={mid} y={12} fill={MARK} anchor="middle">{p.title}</T>
              <line x1={frame.left} x2={frame.right} y1={y(p.level)} y2={y(p.level)} stroke={p.stop ? DOWN : AMBER} strokeWidth="1.5" strokeDasharray={p.stop ? "3 2" : undefined} />
              <Candles bars={p.bars} frame={frame} y={y} slots={FILL_SLOTS} />
              <circle cx={candleX(p.at, FILL_SLOTS, frame)} cy={y(p.price(p.bars[p.at]))} r="3.5" fill={MARK} stroke="#171717" strokeWidth="1" />
              <T x={mid} y={130} fill={INK} anchor="middle">{p.status}</T>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}

/* ---------- size by the tape ---------- */

export function TapeSize() {
  const { NOTIONAL, TAPE } = CONFIG.PAPER;
  const rows = [
    { label: `Index Bullish and breadth over ${TAPE.BREADTH_MIN * 100}%`, mult: 1, name: "full" },
    { label: "One of the two", mult: TAPE.ONE_SIGNAL, name: "half" },
    { label: "Neither", mult: TAPE.NO_SIGNAL, name: "quarter" },
  ];
  return (
    <figure className="my-3 max-w-md rounded-xl bg-neutral-900 p-3">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="text-neutral-300">{r.label}</span>
              <span className="font-mono text-neutral-100">${NOTIONAL * r.mult} · {r.name}</span>
            </div>
            <div className="mt-1 h-2 rounded bg-neutral-800">
              <div className="h-2 rounded bg-emerald-500" style={{ width: `${r.mult * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-[11px] leading-relaxed text-neutral-500">The dollars a paper position gets at the fill, by how many of the two market signals are on.</figcaption>
    </figure>
  );
}

/* ---------- R, MFE and MAE on one trade ---------- */

const R_ENTRY = 40;
const R_STOP = 38.4;
const R_BARS = barsFromCloses([40.4, 39.6, 39.5, 40.6, 41.3, 42.4, 43.2, 43.9, 43.1, 42.6, 42.3], { 0: { o: R_ENTRY }, 2: { l: 39.1 }, 7: { h: 44.5 }, 10: { o: 42.5 } });
const R_MAE = 2;
const R_MFE = 7;
const R_EXIT = 10;

export function RTrade() {
  const frame: Frame = { left: 4, right: 276, top: 14, bottom: 150 };
  const risk = R_ENTRY - R_STOP;
  const y = priceScale(R_BARS, frame, [R_STOP - 0.2, R_ENTRY + 3 * risk]);
  const x = (i: number) => candleX(i, R_BARS.length, frame);
  const inR = (p: number) => (p - R_ENTRY) / risk;
  const signed = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}R`;
  const exit = R_BARS[R_EXIT][0];
  return (
    <Figure
      label="One made-up trade measured in R: the entry, the stop one R under it, lines at one, two and three R above, the lowest low and highest high while it was open, and the exit"
      caption={
        <>
          One trade in R. The distance from the entry to the first stop is the risk, one R; every other price is counted in that unit. MAE is
          the lowest low while the trade was open ({signed(inR(R_BARS[R_MAE][2]))} here, short of the stop), MFE the highest high (
          {signed(inR(R_BARS[R_MFE][1]))}, what was on offer), and the exit is what the rule kept ({signed(inR(exit))}).
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 160`} className="block w-full">
        {[1, 2, 3].map((r) => (
          <g key={r}>
            <line x1={frame.left} x2={frame.right} y1={y(R_ENTRY + r * risk)} y2={y(R_ENTRY + r * risk)} stroke="#333" strokeWidth="1" strokeDasharray="2 3" />
            <T x={frame.right + 5} y={y(R_ENTRY + r * risk) + 3.5} fill={DIM}>+{r}R</T>
          </g>
        ))}
        <line x1={frame.left} x2={frame.right} y1={y(R_ENTRY)} y2={y(R_ENTRY)} stroke={MARK} strokeWidth="1.25" />
        <line x1={frame.left} x2={frame.right} y1={y(R_STOP)} y2={y(R_STOP)} stroke={DOWN} strokeWidth="1.25" strokeDasharray="3 2" />
        <T x={frame.right + 5} y={y(R_ENTRY) + 3.5} fill={MARK}>entry</T>
        <T x={frame.right + 5} y={y(R_STOP) + 3.5} fill={DOWN}>stop −1R</T>
        <Candles bars={R_BARS} frame={frame} y={y} />
        <T x={x(R_MAE)} y={y(R_BARS[R_MAE][2]) + 12} anchor="middle">MAE</T>
        <T x={x(R_MFE)} y={y(R_BARS[R_MFE][1]) - 5} anchor="middle">MFE</T>
        <circle cx={x(R_EXIT)} cy={y(exit)} r="3.5" fill={MARK} stroke="#171717" strokeWidth="1" />
        <T x={x(R_EXIT) - 7} y={y(exit) + 14} fill={MARK} anchor="middle">exit</T>
      </svg>
    </Figure>
  );
}

/* ---------- the bar under a number ---------- */

export function RangeBars() {
  const groups = [
    { title: "Not yet a finding", note: "the ranges overlap", tone: DIM, left: 8, a: [18, 78, 46], b: [58, 128, 94] },
    { title: "A finding", note: "the ranges are apart", tone: UP, left: 182, a: [10, 56, 32], b: [88, 140, 114] },
  ];
  return (
    <Figure
      label="Two pairs of range bars: in the first pair the two ranges overlap, in the second they do not"
      caption={
        <>
          The thin bar under a number is where the true value probably sits (95%); the dot is the number itself. Two numbers differ only when
          their bars do not overlap, however far apart the dots are.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 74`} className="block w-full">
        {groups.map((g) => (
          <g key={g.title}>
            <T x={g.left + 75} y={12} fill={MARK} anchor="middle">{g.title}</T>
            {[g.a, g.b].map(([lo, hi, at], i) => (
              <g key={i}>
                <line x1={g.left} x2={g.left + 150} y1={28 + i * 16} y2={28 + i * 16} stroke="#262626" strokeWidth="3" strokeLinecap="round" />
                <line x1={g.left + lo} x2={g.left + hi} y1={28 + i * 16} y2={28 + i * 16} stroke={i === 0 ? MA_FAST : AMBER} strokeWidth="3" strokeLinecap="round" />
                <circle cx={g.left + at} cy={28 + i * 16} r="3.5" fill={MARK} />
              </g>
            ))}
            <T x={g.left + 75} y={68} fill={g.tone} anchor="middle">{g.note}</T>
          </g>
        ))}
        <Divider x={170} h={70} />
      </svg>
    </Figure>
  );
}

/* ---------- the drill's three outcomes ---------- */

const DRILL_LEVEL = 39;
const DRILL_PRE = [37.2, 37.8, 37.4, 38, 37.6, 38.1];
const DRILL_PANELS = [
  { title: "Ran", status: "", tone: UP, after: [38.6, 39.8, 41, 42.4, 43.6, 44.8, 45.5, 46.2] },
  { title: "Fizzled", status: "broke, then faded", tone: AMBER, after: [38.7, 39.6, 40.2, 39.5, 38.8, 38.2, 37.6, 37.9] },
  { title: "Never filled", status: "never closed above", tone: INK, after: [37.7, 38.2, 37.5, 37.9, 37.3, 37.8, 37.2, 37.5] },
];

export function DrillOutcomes() {
  const sets = DRILL_PANELS.map((p) => barsFromCloses([...DRILL_PRE, ...p.after]));
  const span = { top: 24, bottom: 112 };
  const y = priceScale(sets.flat(), span);
  const n = DRILL_PRE.length + DRILL_PANELS[0].after.length;
  const scanClose = DRILL_PRE[DRILL_PRE.length - 1];
  const best = Math.max(...DRILL_PANELS[0].after);
  const ranNote = `best close +${Math.round((best / scanClose - 1) * 100)}%`;
  return (
    <Figure
      label="Three made-up drill charts with the right side uncovered: one that ran, one that closed above its level and faded, one that never closed above it"
      caption={
        <>
          The three answers a drill chart can have. The lighter half is what was covered when you made the call. Ran: a best close{" "}
          {CONFIG.DRILL.RAN_MFE * 100}% or more over the scan-night close within twenty sessions. Never filled: no close above the level in
          ten sessions. Anything else fizzled.
        </>
      }
    >
      <svg viewBox={`0 0 ${W} 136`} className="block w-full">
        {DRILL_PANELS.map((p, k) => {
          const frame = threeUp(k);
          const mid = (frame.left + frame.right) / 2;
          const cut = frame.left + DRILL_PRE.length * slotWidth(n, frame);
          return (
            <g key={p.title}>
              <T x={mid} y={12} fill={p.tone} anchor="middle">{p.title}</T>
              <rect x={cut} y={span.top - 4} width={frame.right - cut} height={span.bottom - span.top + 8} fill="#ffffff" opacity="0.05" />
              <line x1={frame.left} x2={frame.right} y1={y(DRILL_LEVEL)} y2={y(DRILL_LEVEL)} stroke={AMBER} strokeWidth="1.25" />
              <Candles bars={sets[k]} frame={frame} y={y} />
              <T x={mid} y={130} fill={DIM} anchor="middle">{k === 0 ? ranNote : p.status}</T>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}
