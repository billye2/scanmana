import { broadcast } from "@/lib/push";
import { runScan, type ScanResult } from "@/lib/scan";

let inFlight: Promise<ScanResult> | null = null;

/**
 * Run the scan and push a notification on success. Concurrent callers on the
 * same instance share one run (double-taps of the Run scan button).
 */
export function scanAndNotify(opts: { force?: boolean } = {}): Promise<ScanResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const result = await runScan(opts);
      if (result.status === "ok") {
        const parts = [`${result.newSetups} setup${result.newSetups === 1 ? "" : "s"}`];
        if (result.watchlistAlerts > 0) {
          parts.push(`${result.watchlistAlerts} watchlist breakout${result.watchlistAlerts === 1 ? "" : "s"}`);
        }
        await broadcast("Scanmana nightly scan", `${result.date}: ${parts.join(" · ")}`);
      }
      return result;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
