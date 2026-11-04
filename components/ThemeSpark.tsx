/**
 * A theme's strength over its life (1.7.8): its nightly rank among that
 * night's clusters as a share, drawn as a small line with the top of the box
 * the strongest. Server SVG, no client JS. `strength` oldest first, each value
 * rank / clusters that night (0 = top, 1 = bottom).
 */
export default function ThemeSpark({ strength, nights }: { strength: number[]; nights: number }) {
  const n = strength.length;
  if (n === 0) return <span className="text-[10px] text-neutral-600">—</span>;
  const W = 64, H = 14;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * (W - 2) + 1);
  const y = (p: number) => 1 + Math.min(1, Math.max(0, p)) * (H - 2);
  const pts = strength.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const last = strength[n - 1];
  const title = `Rank over ${nights} night${nights === 1 ? "" : "s"}: top ${Math.round(last * 100)}% of the clusters on its last night`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="inline-block align-middle" role="img" aria-label={title}>
      <title>{title}</title>
      <line x1={1} x2={W - 1} y1={H - 1} y2={H - 1} stroke="#262626" />
      {n > 1 && <polyline points={pts} fill="none" stroke="#a3a3a3" strokeWidth="1.2" strokeLinejoin="round" />}
      <circle cx={x(n - 1)} cy={y(last)} r="1.8" fill="#d97706" />
    </svg>
  );
}
