import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { setStop } from "@/lib/paper-db";

export const dynamic = "force-dynamic";

/** Raise a manual position's stop (raise only; effective from the next session). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { positionId?: unknown; stop?: unknown };
  const positionId = Number(body.positionId);
  if (!Number.isInteger(positionId)) return NextResponse.json({ error: "positionId required" }, { status: 400 });
  if (typeof body.stop !== "number" || !Number.isFinite(body.stop)) return NextResponse.json({ error: "stop required" }, { status: 400 });
  const r = await setStop(userId, positionId, body.stop);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
