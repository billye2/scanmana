import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cancelSell, requestSell } from "@/lib/paper-db";

export const dynamic = "force-dynamic";

/** Queue a sell (default half the shares) at the next open; `{ cancel: true }` withdraws a queued one. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { positionId?: unknown; shares?: unknown; cancel?: unknown };
  const positionId = Number(body.positionId);
  if (!Number.isInteger(positionId)) return NextResponse.json({ error: "positionId required" }, { status: 400 });
  const r = body.cancel === true
    ? await cancelSell(userId, positionId)
    : await requestSell(userId, positionId, typeof body.shares === "number" ? body.shares : undefined);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
