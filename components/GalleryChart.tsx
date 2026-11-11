"use client";

import Chart, { type ChartLine, type ChartMarker } from "@/components/Chart";
import type { Bar, DarvasBox } from "@/lib/types";

/** One best-setup chart: the deck's candles and levels, the scan night and the buy marked, the follow-through visible. */
export default function GalleryChart({ bars, box, pivot, markers, lines }: { bars: Bar[]; box: DarvasBox | null; pivot: number | null; markers: readonly ChartMarker[]; lines?: readonly ChartLine[] }) {
  return (
    <div className="relative mt-2 min-h-[220px] lg:min-h-[260px]">
      <Chart bars={bars} box={box} pivot={pivot} markers={markers} lines={lines} />
    </div>
  );
}
