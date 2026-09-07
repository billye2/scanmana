import Chart from "@/components/Chart";
import { CONFIG } from "@/lib/config";
import { price } from "@/lib/format";
import type { Bar, IndexHealth } from "@/lib/types";

const SHOW_BARS = 130;

export default function IndexCharts({
  bars,
  health,
}: {
  bars: Map<string, Bar[]>;
  health: IndexHealth[] | undefined;
}) {
  const byTicker = new Map((health ?? []).map((h) => [h.ticker, h]));
  return (
    <div className="mt-3 space-y-5">
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
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-semibold text-neutral-100">
                {t}
                <span className="ml-2 font-normal text-neutral-400">{price(shown[shown.length - 1].c)}</span>
              </span>
              {h && (
                <span className="flex gap-2 font-mono text-[11px]">
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
        <span className="text-orange-400">50-day</span>. Status is from the latest scan; candles are the stored daily
        bars.
      </p>
    </div>
  );
}
