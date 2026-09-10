import { runPaperNight } from "@/lib/paper-db";
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
        // Paper book: fills/stops for the sessions since the last run, then tonight's
        // auto orders. Its own try/catch — a paper bug must never block the alert.
        try {
          const paper = await runPaperNight(result.date);
          if (paper.filled || paper.stopped || paper.armed) {
            parts.push(`Paper: ${paper.filled} filled, ${paper.stopped} stopped, ${paper.armed} armed`);
          }
        } catch (err) {
          console.error("paper night failed:", err);
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
