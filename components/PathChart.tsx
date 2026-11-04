// The follow-through chart on /studies (1.7.7): server SVG like TapeCharts, no client JS.
import type { PathSplit } from "@/lib/research";

const INK = "#737373";
const INK2 = "#a3a3a3";
const GRID = "#262626";
/** One colour per group in a split, in the order the reader returns them. */
const LINES = ["#d97706", "#0284c7", "#059669"];
const pc = (x: number) => `${x < 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(1)}%`;

/**
 * Mean gain over the entry per day of the trade (solid, one colour per group)
 * with the mean running low under it (dashed, same colour), day 1 = the entry
 * session. Vertical marks at the book's two exit days: the day-4 half and the
 * day the 10-session average has its full history. Groups without a full path
 * are drawn in the legend as "no rows yet" and left off the chart.
 */
export default function PathChart({ groups, days, marks }: { groups: PathSplit[]; days: number; marks: { day: number; label: string }[] }) {
  const W = 520, H = 220, padL = 40, padR = 10, padT = 12, padB = 22;
  const drawn = groups.filter((g) => g.days.length > 0);
  if (drawn.length === 0) return <p className="text-xs text-neutral-500">No complete paths yet — the outcomes job fills this over its next few runs.</p>;
  const values = drawn.flatMap((g) => g.days.flatMap((d) => [d.mean, d.low]));
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const span = Math.max(0.02, hi - lo);
  const yMin = lo - span * 0.08, yMax = hi + span * 0.08;
  const x = (day: number) => padL + ((day - 1) / (days - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const step = span > 0.3 ? 0.1 : span > 0.12 ? 0.05 : span > 0.05 ? 0.02 : 0.01;
  const ticks: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const pts = (g: PathSplit, pick: (d: PathSplit["days"][number]) => number) => g.days.map((d) => `${x(d.day).toFixed(1)},${y(pick(d)).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Mean gain and mean running low per day of the trade">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#444" : GRID} />
            <text x={padL - 4} y={y(v) + 3} fontSize="9" fill={INK} textAnchor="end">{v === 0 ? "0" : pc(v)}</text>
          </g>
        ))}
        {marks.map((m) => (
          <g key={m.day}>
            <line x1={x(m.day)} x2={x(m.day)} y1={padT} y2={H - padB} stroke="#525252" strokeDasharray="3 3" />
            <text x={x(m.day) + 3} y={padT + 8} fontSize="9" fill={INK2}>{m.label}</text>
          </g>
        ))}
        {drawn.map((g, i) => (
          <g key={g.key}>
            <polyline points={pts(g, (d) => d.low)} fill="none" stroke={LINES[i % LINES.length]} strokeWidth="1.2" strokeDasharray="4 3" strokeLinejoin="round" opacity="0.7" />
            <polyline points={pts(g, (d) => d.mean)} fill="none" stroke={LINES[i % LINES.length]} strokeWidth="2" strokeLinejoin="round" />
            {g.days.map((d) => (
              <circle key={d.day} cx={x(d.day)} cy={y(d.mean)} r="6" fill="transparent">
                <title>{`${g.label} · day ${d.day}: mean ${pc(d.mean)}, median ${pc(d.median)}, mean low ${pc(d.low)} (n=${g.n.toLocaleString()})`}</title>
              </circle>
            ))}
          </g>
        ))}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) =>
          d === 1 || d % 5 === 0 ? (
            <text key={d} x={x(d)} y={H - 6} fontSize="9" fill={INK} textAnchor={d === days ? "end" : d === 1 ? "start" : "middle"}>{d === 1 ? "day 1" : d}</text>
          ) : null,
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
        {groups.map((g) => {
          const i = drawn.indexOf(g);
          return (
            <span key={g.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ background: i >= 0 ? LINES[i % LINES.length] : "#404040" }} />
              {g.label}{i >= 0 ? ` · ${g.n.toLocaleString()} rows` : " · no rows yet"}
            </span>
          );
        })}
        <span className="text-neutral-600">solid mean gain · dashed mean running low</span>
      </div>
    </div>
  );
}
