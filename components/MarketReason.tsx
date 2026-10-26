"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/Icons";

/**
 * The market verdict's reason line, folded to one truncated line by default.
 * A Not-bullish night lists every failing average for QQQ and SPY (a dozen
 * clauses, six lines on a phone) and pushed the deck down the screen; the
 * verdict and the ▲▼ strip already say the same thing. Tap to read it all.
 */
export default function MarketReason({ reason }: { reason: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className="mt-0.5 flex w-full items-start gap-1 text-left text-[11px] text-neutral-500 active:text-neutral-300"
    >
      <span className={`min-w-0 flex-1 ${open ? "" : "truncate"}`}>{reason}</span>
      <ChevronDownIcon size={14} className={`mt-px shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}
