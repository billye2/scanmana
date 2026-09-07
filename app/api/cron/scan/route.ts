import { NextResponse } from "next/server";
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
    return NextResponse.json(await scanAndNotify({ force }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("scan failed:", message);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
