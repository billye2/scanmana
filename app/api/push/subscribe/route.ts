import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sub = await req.json();
  if (typeof sub?.endpoint !== "string" || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  const sql = getSql();
  await sql`
    INSERT INTO push_subscriptions (endpoint, keys)
    VALUES (${sub.endpoint}, ${JSON.stringify(sub.keys)}::jsonb)
    ON CONFLICT (endpoint) DO UPDATE SET keys = EXCLUDED.keys
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { endpoint } = await req.json();
  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  const sql = getSql();
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
  return NextResponse.json({ ok: true });
}
