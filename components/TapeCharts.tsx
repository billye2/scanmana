// Inline-SVG charts for /tape. Server components: no library, no client JS.
import type { BreadthRow } from "@/lib/research";

const INK = "#737373";
const INK2 = "#a3a3a3";
const GRID = "#262626";
const AMBER = "#d97706";
const SKY = "#0284c7";
const GREEN = "#059669";
const RED = "#f87171";
const pct0 = (x: number) => `${Math.round(x * 100)}%`;

function bullishBands(rows: readonly BreadthRow[]): [number, number][] {
  const bands: [number, number][] = [];
  let start: number | null = null;
  rows.forEach((r, i) => {
    if (r.marketBullish && start === null) start = i;
    if (!r.marketBullish && start !== null) {
      bands.push([start, i - 1]);
      start = null;
    }
  });
  if (start !== null) bands.push([start, rows.length - 1]);
  return bands;
}

/**
 * The three breadth lines over the window — share above the 20-day (amber),
 * above the 50-day (sky), with the 10-day over the 20-day (green) — on green
 * bands where the index verdict was Bullish, and the 50% line the sizing rule
 * reads. Rows ascending by date.
 */
export function BreadthLines({ rows }: { rows: BreadthRow[] }) {
  const W = 520, H = 190, padL = 32, padR = 10, padT = 10, padB = 20;
  const n = rows.length;
  if (n < 2) return <p className="text-xs text-neutral-500">Not enough breadth rows yet.</p>;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (p: number) => padT + (1 - p) * (H - padT - padB);
  const line = (pick: (r: BreadthRow) => number | null) =>
    rows.map((r, i) => (pick(r) === null ? null : `${x(i).toFixed(1)},${y(pick(r)!).toFixed(1)}`)).filter(Boolean).join(" ");
  const last = rows[n - 1];
  const tickEvery = Math.max(1, Math.floor(n / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Breadth over time with the index verdict">
      {bullishBands(rows).map(([a, b]) => (
        <rect key={a} x={x(a)} y={padT} width={Math.max(2, x(b) - x(a))} height={H - padT - padB} fill="rgba(52,211,153,.10)">
          <title>Index verdict: Bullish</title>
        </rect>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke={p === 0.5 ? "#444" : GRID} strokeDasharray={p === 0.5 ? "4 3" : undefined} />
          <text x={padL - 4} y={y(p) + 3} fontSize="9" fill={INK} textAnchor="end">{pct0(p)}</text>
        </g>
      ))}
      <polyline points={line((r) => r.pct10Over20)} fill="none" stroke={GREEN} strokeWidth="1.5" strokeLinejoin="round" opacity="0.8" />
      <polyline points={line((r) => r.pctAbove50)} fill="none" stroke={SKY} strokeWidth="1.5" strokeLinejoin="round" opacity="0.9" />
      <polyline points={line((r) => r.pctAbove20)} fill="none" stroke={AMBER} strokeWidth="2" strokeLinejoin="round" />
      {rows.map((r, i) => (
        <circle key={r.date} cx={x(i)} cy={y(r.pctAbove20)} r="5" fill="transparent">
          <title>{`${r.date}: ${pct0(r.pctAbove20)} above 20d${r.pctAbove50 === null ? "" : ` · ${pct0(r.pctAbove50)} above 50d`} · ${pct0(r.pct10Over20)} with 10>20 · ${r.newHighs} highs / ${r.newLows} lows${r.marketBullish === null ? "" : r.marketBullish ? " · index Bullish" : " · index Not bullish"}`}</title>
        </circle>
      ))}
      <circle cx={x(n - 1)} cy={y(last.pctAbove20)} r="4" fill={AMBER} stroke="#171717" strokeWidth="2" />
      <text x={x(n - 1) - 6} y={y(last.pctAbove20) - 8} fontSize="10" fill={INK2} textAnchor="end" fontFamily="ui-monospace, monospace">{pct0(last.pctAbove20)}</text>
      {rows.map((r, i) =>
        i % tickEvery === 0 || i === n - 1 ? (
          <text key={r.date} x={x(i)} y={H - 5} fontSize="9" fill={INK} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}>{r.date.slice(5)}</text>
        ) : null,
      )}
    </svg>
  );
}

/** New 52-week-style highs (up, green) against new lows (down, red) per session, on the same bands. */
export function HighsLows({ rows }: { rows: BreadthRow[] }) {
  const W = 520, H = 120, padL = 32, padR = 10, padT = 6, padB = 6;
  const n = rows.length;
  if (n < 2) return null;
  const peak = Math.max(1, ...rows.map((r) => Math.max(r.newHighs, r.newLows)));
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const mid = padT + (H - padT - padB) / 2;
  const half = (H - padT - padB) / 2;
  const bw = Math.max(1, ((W - padL - padR) / (n - 1)) * 0.7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="New highs against new lows">
      {bullishBands(rows).map(([a, b]) => (
        <rect key={a} x={x(a)} y={padT} width={Math.max(2, x(b) - x(a))} height={H - padT - padB} fill="rgba(52,211,153,.10)" />
      ))}
      <line x1={padL} x2={W - padR} y1={mid} y2={mid} stroke={GRID} />
      <text x={padL - 4} y={padT + 8} fontSize="9" fill={INK} textAnchor="end">{peak}</text>
      <text x={padL - 4} y={H - padB} fontSize="9" fill={INK} textAnchor="end">{peak}</text>
      {rows.map((r, i) => (
        <g key={r.date}>
          <rect x={x(i) - bw / 2} y={mid - (r.newHighs / peak) * half} width={bw} height={(r.newHighs / peak) * half} fill={GREEN} opacity="0.85" />
          <rect x={x(i) - bw / 2} y={mid} width={bw} height={(r.newLows / peak) * half} fill={RED} opacity="0.75" />
          <title>{`${r.date}: ${r.newHighs} new highs, ${r.newLows} new lows`}</title>
        </g>
      ))}
    </svg>
  );
}
