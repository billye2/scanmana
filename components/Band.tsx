import { formatInterval, type Interval } from "@/lib/stats";

/**
 * A number with its 95% range drawn under it (1.7.6): a thin track over a fixed
 * domain, the interval as a bar, the point as a dot. Server component. `kind`
 * sets the domain and the tooltip's unit: rates 0..1, R −1..+1, points −0.3..+0.3.
 * Without an interval it renders the text alone.
 */
export default function Band({
  text,
  value,
  interval,
  kind,
  tone = "text-neutral-100",
}: {
  text: string;
  value: number | null;
  interval: Interval | null;
  kind: "rate" | "r" | "pts";
  tone?: string;
}) {
  if (value === null || !interval) return <span className={tone}>{text}</span>;
  const [min, max] = kind === "rate" ? [0, 1] : kind === "r" ? [-1, 1] : [-0.3, 0.3];
  const W = 56;
  const x = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * W;
  const title = `95% range ${formatInterval(interval, kind)}`;
  return (
    <span className="inline-flex flex-col items-end gap-0.5" title={title}>
      <span className={tone}>{text}</span>
      <svg width={W} height={6} viewBox={`0 0 ${W} 6`} aria-label={title} className="block">
        <line x1={0} x2={W} y1={3} y2={3} stroke="#262626" strokeWidth={2} />
        {min < 0 && <line x1={x(0)} x2={x(0)} y1={0} y2={6} stroke="#404040" strokeWidth={1} />}
        <line x1={x(interval.lo)} x2={x(interval.hi)} y1={3} y2={3} stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.7} />
        <circle cx={x(value)} cy={3} r={2.2} fill="currentColor" />
      </svg>
    </span>
  );
}
