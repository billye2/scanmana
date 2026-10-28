import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { takeSignal } from "@/lib/paper-db";
import { latestScanSlim, loadBars } from "@/lib/scan";
import { buildCandidate } from "@/lib/screen";
import { defaultTakeStop } from "@/lib/stop-plan";

export const dynamic = "force-dynamic";

/**
 * Take a signal into the manual book: the same trigger the deck shows (box top,
 * else the bare pivot) — a buy-stop with the box bottom as the stop if price is
 * still under the trigger; a market buy at the next open with the last session's
 * low as the stop if it is already above (`defaultTakeStop`: the rule the Auto
 * book arms with, so both books price one entry the same way). A watchlist row
 * supplies the trigger and box bottom; any other symbol gets them from its stored
 * bars (as the watchlist Add does). A typed `stop` wins; a pivot-only name has no
 * stop line, so one must be typed.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { ticker?: unknown; stop?: unknown };
  if (typeof body.ticker !== "string" || !body.ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  const ticker = body.ticker.toUpperCase();
  const payload = await latestScanSlim({ tickers: [ticker] });
  const c = payload?.candidates.find((x) => x.ticker === ticker);
  let trigger: number | null = c?.box?.top ?? c?.pivot ?? null;
  let stop: number | null = c?.box?.bottom ?? null;
  let lastClose: number | null = c?.price ?? null;
  if (trigger === null) {
    const rows = (await getSql()`SELECT box_top, box_bottom FROM watchlist WHERE ticker = ${ticker}`) as { box_top: number | null; box_bottom: number | null }[];
    trigger = rows[0]?.box_top ?? null;
    stop = rows[0]?.box_bottom ?? null;
  }
  if (trigger === null || lastClose === null) {
    const bars = (await loadBars([ticker])).get(ticker) ?? [];
    lastClose = bars.at(-1)?.c ?? null;
    if (trigger === null) {
      const built = bars.length > 0 ? buildCandidate(ticker, ticker, bars) : null;
      trigger = built?.box?.top ?? built?.pivot ?? null;
      stop = built?.box?.bottom ?? null;
    }
  }
  if (trigger === null) return NextResponse.json({ error: `${ticker} has no trigger to arm` }, { status: 400 });
  if (lastClose !== null && lastClose > trigger) {
    const bars = c?.bars ?? (await loadBars([ticker])).get(ticker) ?? [];
    stop = defaultTakeStop(bars, trigger, stop);
  }
  if (typeof body.stop === "number" && Number.isFinite(body.stop)) stop = body.stop;
  if (stop === null) return NextResponse.json({ error: `${ticker} has no stop line — type one` }, { status: 400 });
  const r = await takeSignal(userId, ticker, trigger, stop, lastClose);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, trigger, stop });
}
