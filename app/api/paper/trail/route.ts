import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { setTrail } from "@/lib/paper-db";
import type { TrailMode } from "@/lib/paper-engine";

export const dynamic = "force-dynamic";

/** Choose a manual position's trail: none, percent below the peak close, or lowest low of N sessions. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { positionId?: unknown; mode?: unknown; param?: unknown };
  const positionId = Number(body.positionId);
  if (!Number.isInteger(positionId)) return NextResponse.json({ error: "positionId required" }, { status: 400 });
  const mode = body.mode as TrailMode;
  const param = typeof body.param === "number" && Number.isFinite(body.param) ? body.param : null;
  const r = await setTrail(userId, positionId, mode, param);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
