"use client";

import { useMemo } from "react";
import Chart from "@/components/Chart";
import type { Bar, DarvasBox } from "@/lib/types";

/** The simulator's chart: the deck's candles and levels plus the entry and the recommended stop. */
export default function SimChart({ bars, box, pivot, entry, stop }: { bars: Bar[]; box: DarvasBox | null; pivot: number | null; entry: number; stop: number }) {
  const lines = useMemo(
    () => [
      { price: entry, color: "#e5e7eb", title: "entry", style: "solid" as const },
      { price: stop, color: "#f87171", title: "your stop", style: "dashed" as const },
    ],
    [entry, stop],
  );
  return (
    <div className="relative mt-3 min-h-[280px] lg:min-h-[420px]">
      <Chart bars={bars} box={box} pivot={pivot} lines={lines} />
    </div>
  );
}
