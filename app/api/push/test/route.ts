import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { sendTo, type PushSub } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Send a test notification to ONE device — the caller's own subscription
 * (identified by its endpoint) — so "Enable nightly scan alerts" can be
 * verified on the spot instead of waiting for the midnight scan.
 */
export async function POST(req: Request) {
  const { endpoint } = await req.json().catch(() => ({}));
  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  const rows = (await getSql()`SELECT endpoint, keys FROM push_subscriptions WHERE endpoint = ${endpoint}`) as PushSub[];
  if (rows.length === 0) {
    return NextResponse.json({ error: "this device is not subscribed" }, { status: 404 });
  }
  try {
    const ok = await sendTo(rows[0], "Scanmana test alert", "Nightly scan alerts reach this device. The real one lands after each scan, around midnight ET.");
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "the push service says this subscription is gone — enable alerts again" }, { status: 410 });
  } catch (err) {
    const e = err as { statusCode?: number; body?: string; message?: string };
    return NextResponse.json({ error: `push service ${e.statusCode ?? ""} ${e.body || e.message || ""}`.trim() }, { status: 502 });
  }
}
