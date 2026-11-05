import Chart from "@/components/Chart";
import { CONFIG } from "@/lib/config";
import { price } from "@/lib/format";
import type { Bar, IndexHealth } from "@/lib/types";

const SHOW_BARS = 130;

export default function IndexCharts({
  bars,
  health,
  asOf = null,
  provisional = false,
}: {
  bars: Map<string, Bar[]>;
  health: IndexHealth[] | undefined;
  asOf?: string | null; // time of the live quote the charts carry; null = stored bars only
  provisional?: boolean; // today's bar is built from that quote, not from the nightly scan
}) {
  const byTicker = new Map((health ?? []).map((h) => [h.ticker, h]));
  const lastDate = [...bars.values()].reduce<string>((m, b) => (b.length > 0 && b[b.length - 1].date > m ? b[b.length - 1].date : m), "");
  return (
    <div className="mt-3 space-y-5">
      <p className="text-[11px] text-neutral-500">
        {provisional && asOf ? (
          <>
            Today&apos;s candle is <span className="text-sky-300">provisional</span>, from a live quote as of{" "}
            <span className="text-neutral-300">{asOf}</span> · refreshes every 30 minutes on reload
          </>
        ) : lastDate ? (
          <>Through the {lastDate} close</>
        ) : null}
      </p>
      {CONFIG.MARKET.INDICES.map((t) => {
        const all = bars.get(t) ?? [];
        const h = byTicker.get(t);
        // Chart the trailing window but hand the chart extra history so the 50-day is fully formed on the left edge.
        const shown = all.slice(-(SHOW_BARS + Math.max(...CONFIG.MARKET.SMAS)));
        if (shown.length === 0) {
          return (
            <p key={t} className="text-xs text-neutral-500">
              {t}: no bars yet — run <code>npm run seed:indices</code>.
            </p>
          );
        }
        return (
          <div key={t}>
            {/* Wraps at phone width: the price and the four chips do not fit one 390px line (1.8.2). */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
              <span className="whitespace-nowrap font-semibold text-neutral-100">
                {t}
                <span className="ml-2 font-normal text-neutral-400">{price(shown[shown.length - 1].c)}</span>
              </span>
              {h && (
                <span className="flex gap-2 whitespace-nowrap font-mono text-[11px]">
                  <span className={h.fastOverSlow ? "text-emerald-400" : "text-red-400"}>
                    {h.fastOverSlow ? "10>20" : "10<20"}
                  </span>
                  {h.smas.map((s) => (
                    <span
                      key={s.period}
                      className={s.above ? (s.rising ? "text-emerald-400" : "text-amber-300") : "text-red-400"}
                    >
                      {s.period}d {s.above ? "▲" : "▼"}
                      {s.rising ? "" : "·flat"}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className="relative mt-1 h-[26rem] overflow-hidden rounded-lg bg-neutral-900/60 lg:h-[34rem]">
              <Chart bars={shown} box={null} pivot={null} smas={CONFIG.MARKET.SMAS} />
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-neutral-500">
        Lines: <span className="text-sky-400">10-day</span> · <span className="text-purple-400">20-day</span> ·{" "}
        <span className="text-orange-400">50-day</span>. Candles are the stored daily bars plus today&apos;s provisional
        bar during the session; the chips are recomputed from them, so they can differ from the strip&apos;s verdict, which
        stays on the scan night&apos;s close. Today&apos;s volume is assumed at the 20-day average.
      </p>
    </div>
  );
}
