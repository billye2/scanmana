import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { drillScore, type DrillCall } from "@/lib/drill";
import { clearDrillAnswers, drillAnswers, saveDrillAnswer } from "@/lib/drill-db";

export const dynamic = "force-dynamic";

const CALLS = new Set<string>(["take", "skip"]);

/**
 * The drill's one write (1.8.5). POST { date, ticker, call } stores the reader's
 * call on that scan-night row and returns the record so far (lib/drill.ts
 * drillScore), so the card can show the running score without a reload. The
 * grade itself is the client's to compute: it already holds the row.
 * DELETE forgets every call this reader made.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { date?: unknown; ticker?: unknown; call?: unknown } | null;
  if (!body || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (typeof body.ticker !== "string" || !/^[A-Z.\-]{1,10}$/.test(body.ticker)) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  if (typeof body.call !== "string" || !CALLS.has(body.call)) {
    return NextResponse.json({ error: "call must be take or skip" }, { status: 400 });
  }
  try {
    await saveDrillAnswer(userId, body.date, body.ticker, body.call as DrillCall);
    const score = drillScore(await drillAnswers(userId));
    return NextResponse.json({ ok: true, score });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    await clearDrillAnswers(userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
