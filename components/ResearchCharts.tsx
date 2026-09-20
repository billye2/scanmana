// Small inline-SVG charts for /research. Server components: no library, no
// client JS. One scale per chart (no dual axes): the sweep shows deck size and
// hit rate as two stacked panels sharing the x axis.
import type { BreadthBucket, BreadthRow, SweepPoint } from "@/lib/research";

const INK = "#737373";
const INK2 = "#a3a3a3";
const GRID = "#262626";
const AMBER = "#d97706";
const SKY = "#0284c7";
const GREEN = "#059669";
const RED = "#f87171";

const pct0 = (x: number) => `${Math.round(x * 100)}%`;

/** Horizontal bars of a rate (0–1) with the sample size on the right. */
export function RateBars({ rows, max = 0.6 }: { rows: { label: string; rate: number | null; n: number }[]; max?: number }) {
  const W = 340, rowH = 20, top = 6, left = 96, right = 60;
  const H = top + rows.length * (rowH + 4) + 16;
  const x = (v: number) => left + (Math.min(v, max) / max) * (W - left - right);
  const ticks = [0, max / 3, (2 * max) / 3, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Breakout rate by group">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top} y2={H - 14} stroke={GRID} />
          <text x={x(t)} y={H - 3} fontSize="10" fill={INK} textAnchor="middle">{pct0(t)}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = top + i * (rowH + 4);
        return (
          <g key={r.label}>
            <text x={left - 8} y={y + 14} fontSize="11" fill={INK2} textAnchor="end">{r.label}</text>
            {r.rate === null ? (
              <text x={left + 4} y={y + 14} fontSize="10" fill={INK}>no labelled rows yet</text>
            ) : (
              <>
                <rect x={left} y={y + 2} width={Math.max(0, x(r.rate) - left)} height={rowH - 4} rx="3" fill={AMBER}>
                  <title>{`${r.label}: ${pct0(r.rate)} broke out within 10 sessions (n=${r.n})`}</title>
                </rect>
                <text x={x(r.rate) + 6} y={y + 14} fontSize="10" fill={INK2} fontFamily="ui-monospace, monospace">{pct0(r.rate)}</text>
              </>
            )}
            <text x={W - 2} y={y + 14} fontSize="10" fill={INK} textAnchor="end">n={r.n}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** One sweep parameter: deck size and hit rate stacked, current value marked. */
export function SweepPanel({ points, fmt }: { points: SweepPoint[]; fmt: (v: number) => string }) {
  const W = 300, panelH = 70, padL = 34, padR = 12, padT = 14, between = 24, bottom = 18;
  const H = padT + panelH * 2 + between + bottom;
  const n = points.length;
  if (n === 0) return <p className="text-xs text-neutral-500">No sweep yet.</p>;
  const xs = (i: number) => padL + (n === 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const ci = Math.max(0, points.findIndex((p) => p.isCurrent));
  const deckMax = Math.max(60, ...points.map((p) => p.deckSize)) * 1.05;
  const panel = (y0: number, vals: (number | null)[], color: string, label: string, max: number, f: (v: number) => string) => {
    const ys = (v: number) => y0 + panelH - (v / max) * panelH;
    const d = vals.map((v, i) => (v === null ? null : `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`)).filter(Boolean);
    return (
      <g>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={ys(v)} y2={ys(v)} stroke={GRID} />
            <text x={padL - 4} y={ys(v) + 3} fontSize="9" fill={INK} textAnchor="end">{f(v)}</text>
          </g>
        ))}
        <text x={padL} y={y0 - 5} fontSize="11" fill={INK2}>{label}</text>
        {d.length > 1 && <polyline points={d.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />}
        {vals.map((v, i) =>
          v === null ? null : (
            <circle key={i} cx={xs(i)} cy={ys(v)} r={i === ci ? 4.5 : 3} fill={color} stroke="#171717" strokeWidth="2">
              <title>{`${fmt(points[i].value)}: ${label} ${f(v)}${points[i].n ? ` (n=${points[i].n})` : ""}`}</title>
            </circle>
          ),
        )}
        {vals[ci] !== null && (
          <text x={xs(ci) + 6} y={ys(vals[ci]!) - 6} fontSize="10" fill={INK2} fontFamily="ui-monospace, monospace">{f(vals[ci]!)}</text>
        )}
      </g>
    );
  };
  const y1 = padT + 10, y2 = y1 + panelH + between;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Threshold sweep">
      <line x1={xs(ci)} x2={xs(ci)} y1={padT} y2={H - bottom} stroke="#fbbf24" strokeDasharray="3 3" />
      {panel(y1, points.map((p) => p.deckSize), SKY, "Deck size / night", deckMax, (v) => String(Math.round(v)))}
      {panel(y2, points.map((p) => p.hitRate), AMBER, "Hit rate (10d)", 0.6, pct0)}
      {points.map((p, i) =>
        i % Math.ceil(n / 6) === 0 || i === n - 1 || i === ci ? (
          <text key={i} x={xs(i)} y={H - 4} fontSize="9" fill={i === ci ? "#fbbf24" : INK} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}>
            {fmt(p.value)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Breadth line with the sessions the index verdict called Bullish shaded. */
export function BreadthLine({ rows }: { rows: BreadthRow[] }) {
  const W = 520, H = 170, padL = 32, padR = 10, padT = 10, padB = 20;
  const n = rows.length;
  if (n < 2) return <p className="text-xs text-neutral-500">Not enough breadth rows yet.</p>;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (p: number) => padT + (1 - p) * (H - padT - padB);
  const bands: [number, number][] = [];
  let start: number | null = null;
  rows.forEach((r, i) => {
    if (r.marketBullish && start === null) start = i;
    if (!r.marketBullish && start !== null) { bands.push([start, i - 1]); start = null; }
  });
  if (start !== null) bands.push([start, n - 1]);
  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.pctAbove20).toFixed(1)}`).join(" ");
  const last = rows[n - 1];
  const tickEvery = Math.max(1, Math.floor(n / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Breadth over time">
      {bands.map(([a, b]) => (
        <rect key={a} x={x(a)} y={padT} width={Math.max(2, x(b) - x(a))} height={H - padT - padB} fill="rgba(52,211,153,.10)">
          <title>Index verdict: Bullish</title>
        </rect>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke={p === 0.5 ? "#333" : GRID} />
          <text x={padL - 4} y={y(p) + 3} fontSize="9" fill={INK} textAnchor="end">{pct0(p)}</text>
        </g>
      ))}
      <polygon points={`${pts} ${x(n - 1).toFixed(1)},${y(0)} ${x(0)},${y(0)}`} fill="rgba(217,119,6,.10)" />
      <polyline points={pts} fill="none" stroke={AMBER} strokeWidth="2" strokeLinejoin="round" />
      {rows.map((r, i) => (
        <circle key={r.date} cx={x(i)} cy={y(r.pctAbove20)} r="5" fill="transparent">
          <title>{`${r.date}: ${pct0(r.pctAbove20)} above 20d · ${r.newHighs} highs / ${r.newLows} lows${r.marketBullish === null ? "" : r.marketBullish ? " · index Bullish" : " · index Not bullish"}`}</title>
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

/** Vertical bars for a handful of buckets. */
export function BucketBars({ buckets, max = 0.6 }: { buckets: BreadthBucket[]; max?: number }) {
  const W = 220, H = 150, padL = 28, padR = 6, padT = 16, padB = 22;
  const n = buckets.length;
  if (n === 0) return null;
  const bw = (W - padL - padR) / n;
  const y = (v: number) => padT + (1 - Math.min(v, max) / max) * (H - padT - padB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Hit rate by breadth">
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#333" : GRID} />
          <text x={padL - 4} y={y(v) + 3} fontSize="9" fill={INK} textAnchor="end">{pct0(v)}</text>
        </g>
      ))}
      {buckets.map((b, i) => {
        const x0 = padL + i * bw + 3, w = bw - 6;
        return (
          <g key={b.label}>
            {b.hitRate !== null && (
              <rect x={x0} y={y(b.hitRate)} width={w} height={y(0) - y(b.hitRate)} rx="3" fill={AMBER}>
                <title>{`Breadth ${b.label}: ${pct0(b.hitRate)} of deck names broke out within 10 sessions (n=${b.n})`}</title>
              </rect>
            )}
            <text x={x0 + w / 2} y={b.hitRate === null ? y(0) - 4 : y(b.hitRate) - 4} fontSize="9" fill={INK2} textAnchor="middle" fontFamily="ui-monospace, monospace">
              {b.hitRate === null ? "—" : pct0(b.hitRate)}
            </text>
            <text x={x0 + w / 2} y={H - 6} fontSize="9" fill={INK} textAnchor="middle">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Histogram of R multiples (closed trades), losses red, wins green. */
export function RHistogram({ rs }: { rs: number[] }) {
  const edges = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 2, 3, 4, 6, 10];
  const labels = ["−2", "−1.5", "−1", "−.5", "0", "+.5", "+1", "+2", "+3", "+4", "+6"];
  const counts = new Array(edges.length - 1).fill(0) as number[];
  for (const r of rs) {
    const i = edges.findIndex((e, k) => k < edges.length - 1 && r >= e && r < edges[k + 1]);
    if (i >= 0) counts[i]++;
    else if (r < edges[0]) counts[0]++;
    else counts[counts.length - 1]++;
  }
  const W = 360, H = 150, padL = 24, padR = 6, padT = 14, padB = 22;
  const n = counts.length, bw = (W - padL - padR) / n, max = Math.max(4, ...counts);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  if (rs.length === 0) return <p className="text-xs text-neutral-500">No closed trades yet.</p>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="R multiple per closed trade">
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#333" : GRID} />
          <text x={padL - 4} y={y(v) + 3} fontSize="9" fill={INK} textAnchor="end">{Math.round(v)}</text>
        </g>
      ))}
      {counts.map((c, i) => {
        const x0 = padL + i * bw + 2, w = bw - 4;
        return (
          <g key={i}>
            <rect x={x0} y={y(c)} width={w} height={y(0) - y(c)} rx="3" fill={edges[i] < 0 ? RED : GREEN}>
              <title>{`${c} trade${c === 1 ? "" : "s"} between ${labels[i]}R and ${labels[i + 1] ?? "+10"}R`}</title>
            </rect>
            {c > 0 && <text x={x0 + w / 2} y={y(c) - 3} fontSize="9" fill={INK2} textAnchor="middle" fontFamily="ui-monospace, monospace">{c}</text>}
            <text x={x0 + w / 2} y={H - 6} fontSize="9" fill={INK} textAnchor="middle">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}
