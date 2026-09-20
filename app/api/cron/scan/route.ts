import { NextResponse, after } from "next/server";
import { triggerResearch } from "@/lib/research";
import { scanAndNotify } from "@/lib/scan-notify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    const result = await scanAndNotify({ force });
    // Research layer (api/research_job.py): runs after the response, skips jobs already
    // current for the latest scan, so the 1:30am catch-up run (scan "skipped") is where it
    // normally does its work with the full time budget. Failures are logged, never raised.
    after(async () => {
      const r = await triggerResearch({});
      console.log("research:", JSON.stringify(r));
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("scan failed:", message);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
