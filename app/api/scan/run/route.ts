import { NextResponse } from "next/server";
import { scanAndNotify } from "@/lib/scan-notify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Backs the "Run scan" button. Unauthenticated by design (single-user app with
// no login), but never forces: if today's scan already exists it returns
// "skipped", so the worst an outsider can do is trigger the scan the nightly
// cron would run anyway.
export async function POST() {
  try {
    return NextResponse.json(await scanAndNotify({ force: false }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("manual scan failed:", message);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
