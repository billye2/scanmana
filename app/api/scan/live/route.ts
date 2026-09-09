import { NextResponse } from "next/server";
import { deckLive } from "@/lib/livewatch";

export const dynamic = "force-dynamic";

/** GET /api/scan/live → live status of every name in tonight's deck (shared quote cache, budgeted refetch). */
export async function GET() {
  try {
    return NextResponse.json(await deckLive());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 503 });
  }
}
