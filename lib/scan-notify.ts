import { briefPush } from "@/lib/paper-engine";
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
        // The push leads with tomorrow morning's actions ("At the open: buy …"), then
        // the counts of what the sessions just processed did.
        try {
          const paper = await runPaperNight(result.date);
          const morning = paper.brief ? briefPush(paper.brief) : null;
          if (morning) parts.unshift(morning);
          if (paper.filled || paper.stopped || paper.sold || paper.armed) {
            parts.push(
              `Paper: ${paper.filled} filled, ${paper.stopped} stopped${paper.sold ? `, ${paper.sold} sold` : ""}, ${paper.armed} armed${paper.tape && paper.tape.label !== "full" ? ` · ${paper.tape.label} size` : ""}`,
            );
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
