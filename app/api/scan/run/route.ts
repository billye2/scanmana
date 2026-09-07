import { NextResponse } from "next/server";
import { scanAndNotify } from "@/lib/scan-notify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Backs the "Run scan" button. Gated by the Clerk proxy like every /api route
// except the cron, and never forces: if today's scan already exists it returns
// "skipped".
export async function POST() {
  try {
    return NextResponse.json(await scanAndNotify({ force: false }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("manual scan failed:", message);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
