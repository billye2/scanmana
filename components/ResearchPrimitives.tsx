// Shared building blocks for /research and /studies (split in 1.7.5): headings,
// cards, table cell classes and the number formats, so both pages read as one.

export function H({ id, children, sub }: { id: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mt-8 mb-3">
      <h2 id={id} className="text-sm font-semibold tracking-wide text-emerald-400 uppercase">{children}</h2>
      {sub && <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">{sub}</p>}
    </div>
  );
}

export const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl bg-neutral-900 p-3 ${className}`}>{children}</div>
);

export const TH = "px-2 py-1.5 text-left text-[10px] font-semibold tracking-wide text-neutral-500 uppercase whitespace-nowrap";
export const TD = "px-2 py-1.5 text-xs text-neutral-300 whitespace-nowrap";
export const NUM = `${TD} text-right font-mono tabular-nums`;
export const SUMMARY = "cursor-pointer select-none text-[12px] text-neutral-400 marker:text-neutral-600 hover:text-neutral-200";

export const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
export const rr = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
export const money = (x: number | null) => (x === null ? "—" : `${x < 0 ? "−" : "+"}$${Math.abs(x).toFixed(0)}`);
export const n = (x: number) => x.toLocaleString();
