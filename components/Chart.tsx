"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
} from "lightweight-charts";
import { useEffect, useRef, type MutableRefObject } from "react";
import type { Bar, DarvasBox } from "@/lib/types";

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

export default function Chart({
  bars,
  box,
  pivot,
  smas = [10, 20],
  shotRef,
}: {
  bars: Bar[];
  box: DarvasBox | null;
  pivot: number | null;
  smas?: readonly number[];
  /** Filled with a () => canvas snapshot of the chart (lightweight-charts takeScreenshot) while mounted. */
  shotRef?: MutableRefObject<(() => HTMLCanvasElement) | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);

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

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.timeScale().fitContent());
    ro.observe(el);

    if (shotRef) shotRef.current = () => chart.takeScreenshot();
    return () => {
      if (shotRef) shotRef.current = null;
      ro.disconnect();
      chart.remove();
    };
  }, [bars, box, pivot, smas, shotRef]);

  // absolute inset-0: the parent is a flex-1 item whose height comes from flex
  // layout, not an explicit value, so a percentage height would resolve to 0.
  return <div ref={ref} className="absolute inset-0" />;
}
