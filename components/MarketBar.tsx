import Link from "next/link";
import type { BreadthRow } from "@/lib/research";
import type { MarketHealth } from "@/lib/types";

const TONE = {
  bullish: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Bullish" },
  "not-bullish": { dot: "bg-red-400", text: "text-red-300", label: "Not bullish" },
} as const;

export default function MarketBar({ market, breadth }: { market: MarketHealth | undefined; breadth?: { today: BreadthRow; prev: BreadthRow | null } | null }) {
  if (!market) {
    return (
      <div className="mb-3 rounded-xl bg-neutral-900 px-3 py-2 text-[11px] text-neutral-500">
        Market health unavailable — run <code>npm run seed:indices</code> then rescan.
      </div>
    );
  }
  const t = TONE[market.verdict];
  return (
    <Link href="/help#market" className="mb-3 block rounded-xl bg-neutral-900 px-3 py-2 active:bg-neutral-800">
      <div className="flex items-center gap-2 text-xs">
        <span className={`inline-block h-2 w-2 rounded-full ${t.dot}`} />
        <span className={`font-semibold ${t.text}`}>Market {t.label}</span>
        <span className="ml-auto flex gap-2 font-mono text-[11px]">
          {market.indices.map((i) => (
            <span key={i.ticker} className="text-neutral-400">
              {i.ticker}
              <span
                className={`ml-0.5 ${i.fastOverSlow ? "text-emerald-400" : "text-red-400"}`}
                title={`10-day ${i.fastOverSlow ? "above" : "below"} 20-day`}
              >
                {i.fastOverSlow ? "10>20" : "10<20"}
              </span>
              {i.smas.map((s) => (
                <span
                  key={s.period}
                  className={`ml-0.5 ${s.above ? (s.rising ? "text-emerald-400" : "text-amber-300") : "text-red-400"}`}
                  title={`${s.period}-day ${s.above ? "above" : "below"}${s.rising ? ", rising" : ", falling"}`}
                >
                  {s.above ? "▲" : "▼"}
                </span>
              ))}
            </span>
          ))}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-neutral-500">{market.reason}</div>
      {breadth && <BreadthLine b={breadth.today} prev={breadth.prev} bullish={market.verdict === "bullish"} />}
    </Link>
  );
}

/**
 * Breadth from the research layer (research/breadth.py): share of the whole
 * universe above its 20-day average. Amber when the index verdict says Bullish
 * on a thin tape (under 40%) — the case the QQQ/SPY filter cannot see.
 */
function BreadthLine({ b, prev, bullish }: { b: BreadthRow; prev: BreadthRow | null; bullish: boolean }) {
  const pct = Math.round(b.pctAbove20 * 100);
  const up = prev ? b.pctAbove20 >= prev.pctAbove20 : null;
  const thin = bullish && b.pctAbove20 < 0.4;
  const tone = thin ? "text-amber-300" : b.pctAbove20 >= 0.5 ? "text-emerald-300" : "text-red-300";
  return (
    <div className="mt-1 text-[11px] text-neutral-400">
      Breadth <span className={`font-semibold ${tone}`}>{pct}%</span> above 20d
      {up !== null && <span className={up ? "text-emerald-400" : "text-red-400"}> {up ? "▲" : "▼"}</span>}
      {b.pctAbove50 !== null && <> · {Math.round(b.pctAbove50 * 100)}% above 50d</>}
      {" · "}<span className="font-mono">{b.newHighs}</span> new highs / <span className="font-mono">{b.newLows}</span> lows
      {thin && <span className="text-amber-300"> · narrow tape: only the leaders are working</span>}
    </div>
  );
}
