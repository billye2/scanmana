"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomInIcon, ZoomOutIcon } from "@/components/Icons";
import type { Bar, DarvasBox } from "@/lib/types";

/** Bars in the zoomed window (30 sessions ≈ six trading weeks), plus a small right margin. */
const ZOOM_BARS = 30;
const ZOOM_RIGHT_MARGIN = 2;

function smaSeries(bars: Bar[], period: number): { time: string; value: number }[] {
  const out: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= period) sum -= bars[i - period].c;
    if (i >= period - 1) out.push({ time: bars[i].date, value: sum / period });
  }
  return out;
}

const SMA_COLORS: Record<number, string> = { 10: "#60a5fa", 20: "#c084fc", 50: "#fb923c" };

/**
 * Candles with SMAs and the trade levels. The zoom pill toggles between the
 * full window (fitContent) and the last ZOOM_BARS sessions. `zoomed` /
 * `onZoomChange` make it controlled (the deck shares one state across cards);
 * without them each chart keeps its own.
 */
export default function Chart({
  bars,
  box,
  pivot,
  smas = [10, 20],
  zoomed: zoomedProp,
  onZoomChange,
}: {
  bars: Bar[];
  box: DarvasBox | null;
  pivot: number | null;
  smas?: readonly number[];
  zoomed?: boolean;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [zoomedLocal, setZoomedLocal] = useState(false);
  const zoomed = zoomedProp ?? zoomedLocal;
  const setZoomed = onZoomChange ?? setZoomedLocal;

  const applyView = useCallback(
    (chart: IChartApi) => {
      if (zoomed && bars.length > 0) {
        const to = bars.length - 0.5 + ZOOM_RIGHT_MARGIN;
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(-0.5, to - ZOOM_BARS - ZOOM_RIGHT_MARGIN), to });
      } else {
        chart.timeScale().fitContent();
      }
    },
    [zoomed, bars.length],
  );
  // The build effect and the ResizeObserver read the latest applyView through a
  // ref; assigned in an effect (declared first, so it runs first) not in render.
  const applyViewRef = useRef(applyView);
  useEffect(() => {
    applyViewRef.current = applyView;
  }, [applyView]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const chart: IChartApi = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b949e",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(139, 148, 158, 0.08)" },
        horzLines: { color: "rgba(139, 148, 158, 0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(139, 148, 158, 0.2)" },
      timeScale: { borderColor: "rgba(139, 148, 158, 0.2)", timeVisible: false },
      handleScroll: { pressedMouseMove: true, horzTouchDrag: false, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      // autoSize tracks the container via ResizeObserver; the explicit fallback
      // covers the first paint if the container hasn't been laid out yet.
      autoSize: true,
      height: el.clientHeight || 300,
      width: el.clientWidth || 320,
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#f87171",
      borderUpColor: "#34d399",
      borderDownColor: "#f87171",
      wickUpColor: "#34d399",
      wickDownColor: "#f87171",
    });
    candles.setData(
      bars.map((b) => ({ time: b.date, open: b.o, high: b.h, low: b.l, close: b.c })),
    );

    for (const period of smas) {
      const line = chart.addSeries(LineSeries, {
        color: SMA_COLORS[period] ?? "#8b949e",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(smaSeries(bars, period));
    }

    if (box) {
      candles.createPriceLine({
        price: box.top,
        color: "#f59e0b",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        title: "trigger",
      });
      candles.createPriceLine({
        price: box.bottom,
        color: "#f59e0b",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "stop",
      });
    }
    if (pivot !== null && (!box || Math.abs(pivot - box.top) / pivot > 0.005)) {
      candles.createPriceLine({
        price: pivot,
        color: "#60a5fa",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "pivot",
      });
    }

    chartRef.current = chart;
    applyViewRef.current(chart);
    // Re-apply the chosen window (not just fitContent) so a resize keeps the zoom.
    const ro = new ResizeObserver(() => applyViewRef.current(chart));
    ro.observe(el);

    return () => {
      ro.disconnect();
      chartRef.current = null;
      chart.remove();
    };
  }, [bars, box, pivot, smas]);

  useEffect(() => {
    if (chartRef.current) applyView(chartRef.current);
  }, [applyView]);

  // absolute inset-0: the parent is a flex-1 item whose height comes from flex
  // layout, not an explicit value, so a percentage height would resolve to 0.
  return (
    <>
      <div ref={ref} className="absolute inset-0" />
      <button
        type="button"
        onClick={() => setZoomed(!zoomed)}
        aria-pressed={zoomed}
        aria-label={zoomed ? "Show all bars" : `Zoom to the last ${ZOOM_BARS} sessions`}
        className="absolute left-1 top-1 z-10 flex items-center gap-1 rounded bg-neutral-900/80 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300 active:bg-neutral-800"
      >
        {zoomed ? <ZoomOutIcon size={12} /> : <ZoomInIcon size={12} />}
        {zoomed ? "All" : `${ZOOM_BARS}d`}
      </button>
    </>
  );
}
