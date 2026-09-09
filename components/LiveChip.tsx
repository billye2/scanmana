import type { WatchStatus } from "@/lib/livewatch";

// One wording for the live read everywhere (watchlist, deck card, deck list).
// It says what price is doing against the trigger — never "buy".
export const LIVE_CHIP: Record<WatchStatus, [string, string]> = {
  breaking: ["⚡ breaking out", "bg-emerald-500/90 text-neutral-950"],
  failed: ["failed back inside", "bg-red-900/70 text-red-200"],
  stopped: ["below stop", "bg-red-900/70 text-red-200"],
  approaching: ["approaching", "bg-amber-900/70 text-amber-200"],
  quiet: ["quiet", "bg-neutral-800 text-neutral-400"],
};

export function liveLabel(status: WatchStatus): string {
  return LIVE_CHIP[status][0];
}

/** Status chip; `muted` outside market hours (the read is as of the close). */
export default function LiveChip({ status, muted = false, className = "" }: { status: WatchStatus; muted?: boolean; className?: string }) {
  const [label, tone] = LIVE_CHIP[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tone} ${muted ? "opacity-60" : ""} ${className}`}>
      {label}
    </span>
  );
}
