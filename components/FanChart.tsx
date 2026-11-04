import type { FanRow } from "@/lib/research";

/**
 * The drawdown fan (1.8.0): cumulative R of 5,000 shuffles of the plan's own
 * history, 5–95% light and the middle half darker, the median as a line, and
 * the Auto book's actual path over it in amber. Plain SVG with no hooks, so it
 * renders inside the client-side paper book.
 */
export default function FanChart({ rows, path }: { rows: FanRow[]; path: number[] }) {
  const W = 520, H = 200, padL = 36, padR = 10, padT = 10, padB = 20;
  const n = rows.length;
  if (n === 0) return null;
  const last = Math.max(n, path.length);
  const lo = Math.min(0, ...rows.map((r) => r.q05), ...path);
  const hi = Math.max(0, ...rows.map((r) => r.q95), ...path);
  const x = (t: number) => padL + ((t - 1) / Math.max(1, last - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - padT - padB);
  const band = (top: (r: FanRow) => number, bottom: (r: FanRow) => number) =>
    [...rows.map((r) => `${x(r.trades).toFixed(1)},${y(top(r)).toFixed(1)}`), ...[...rows].reverse().map((r) => `${x(r.trades).toFixed(1)},${y(bottom(r)).toFixed(1)}`)].join(" ");
  const line = (pick: (r: FanRow) => number) => rows.map((r) => `${x(r.trades).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(" ");
  const step = hi - lo > 40 ? 10 : hi - lo > 16 ? 5 : hi - lo > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const book = path.map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Cumulative R by chance, with the book's own path">
      <polygon points={band((r) => r.q95, (r) => r.q05)} fill="rgba(163,163,163,.12)" />
      <polygon points={band((r) => r.q75, (r) => r.q25)} fill="rgba(163,163,163,.22)" />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#525252" : "#262626"} />
          <text x={padL - 4} y={y(v) + 3} fontSize="9" fill="#737373" textAnchor="end">{v > 0 ? `+${v}` : v}R</text>
        </g>
      ))}
      <polyline points={line((r) => r.q50)} fill="none" stroke="#a3a3a3" strokeWidth="1.2" strokeDasharray="4 3" />
      {path.length > 1 && <polyline points={book} fill="none" stroke="#d97706" strokeWidth="2" strokeLinejoin="round" />}
      {path.length > 0 && <circle cx={x(path.length)} cy={y(path[path.length - 1])} r="3.5" fill="#d97706" stroke="#171717" strokeWidth="1.5" />}
      {rows.map((r) => (
        <circle key={r.trades} cx={x(r.trades)} cy={y(r.q50)} r="5" fill="transparent">
          <title>{`After ${r.trades} trades: median ${r.q50 >= 0 ? "+" : ""}${r.q50.toFixed(1)}R · middle half ${r.q25.toFixed(1)} to ${r.q75.toFixed(1)}R · 5–95% ${r.q05.toFixed(1)} to ${r.q95.toFixed(1)}R${path[r.trades - 1] !== undefined ? ` · book ${path[r.trades - 1] >= 0 ? "+" : ""}${path[r.trades - 1].toFixed(1)}R` : ""}`}</title>
        </circle>
      ))}
      {[1, ...[10, 20, 30, 40, 50, 60].filter((t) => t <= last), last].filter((t, i, a) => a.indexOf(t) === i).map((t) => (
        <text key={t} x={x(t)} y={H - 6} fontSize="9" fill="#737373" textAnchor={t === last ? "end" : t === 1 ? "start" : "middle"}>{t === 1 ? "trade 1" : t}</text>
      ))}
    </svg>
  );
}
