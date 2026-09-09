import { NextResponse } from "next/server";
import { candidateBars } from "@/lib/scan";

export const dynamic = "force-dynamic";

/**
 * GET /api/scan/bars?ticker=XHLD&date=2026-09-08 → that card's bars from the
 * scan payload (latest scan if date is omitted). The home page embeds bars only
 * for the first cards; the deck fetches the rest here as you page.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  const date = url.searchParams.get("date");
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  try {
    const bars = await candidateBars(ticker.toUpperCase(), date || null);
    if (!bars) return NextResponse.json({ error: "not in that deck" }, { status: 404 });
    // A scan's bars never change once stored, so the browser may keep them for the day.
    return NextResponse.json(bars, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 503 });
  }
}
