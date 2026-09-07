import { NextResponse } from "next/server";
import { watchlistLive } from "@/lib/livewatch";

export const dynamic = "force-dynamic";

/** GET /api/watchlist/live → live status of every watched name (shared 60s quote cache). */
export async function GET() {
  try {
    return NextResponse.json(await watchlistLive());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 503 });
  }
}
