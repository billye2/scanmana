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
