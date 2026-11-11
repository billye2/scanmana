import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { addDays } from "@/lib/dates";
import { drillScore, type DrillCall } from "@/lib/drill";
import { clearDrillAnswers, drillAnswers, drillRow, saveDrillAnswer } from "@/lib/drill-db";
import { BOOK_STOP, gradeStops, inStopDrill, isStopKey, type StopDrill } from "@/lib/drill-stop";
import { galleryWindow } from "@/lib/gallery";
import { loadBarWindows } from "@/lib/scan";

export const dynamic = "force-dynamic";

const CALLS = new Set<string>(["take", "skip"]);

/**
 * The drill's one write (1.8.5). POST { date, ticker, call } stores the reader's
 * call on that scan-night row and returns the record so far (lib/drill.ts
 * drillScore), so the card can show the running score without a reload. The
 * grade itself is the client's to compute: it already holds the row.
 * Since 1.9.2 a Take on a boxed card carries `stop` (lib/drill-stop.ts STOP_KEYS):
 * the server grades all four stops on that trade from its own bars, which run
 * STOP_AFTER_DAYS past the scan night (the page's chart holds about a month),
 * stores the reader's R beside the book's, and returns the table.
 * DELETE forgets every call this reader made.
 */
const STOP_AFTER_DAYS = 115; // calendar days: ten sessions to the breakout and sixty for the trade
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { date?: unknown; ticker?: unknown; call?: unknown; stop?: unknown } | null;
  if (!body || typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (typeof body.ticker !== "string" || !/^[A-Z.\-]{1,10}$/.test(body.ticker)) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  if (typeof body.call !== "string" || !CALLS.has(body.call)) {
    return NextResponse.json({ error: "call must be take or skip" }, { status: 400 });
  }
  if (body.stop !== undefined && (body.call !== "take" || !isStopKey(body.stop))) {
    return NextResponse.json({ error: "stop goes with a take and must be a known level" }, { status: 400 });
  }
  try {
    let stops: StopDrill | null = null;
    if (isStopKey(body.stop)) {
      const row = await drillRow(body.date, body.ticker);
      if (!row || !inStopDrill(row)) return NextResponse.json({ error: "no stop question on this card" }, { status: 400 });
      const window = { ticker: row.ticker, since: galleryWindow(row.date).since, until: addDays(row.date, STOP_AFTER_DAYS) };
      stops = gradeStops(row, (await loadBarWindows([window])).get(row.ticker) ?? []);
      const r = (key: string) => stops!.results.find((x) => x.key === key)?.r ?? null;
      await saveDrillAnswer(userId, body.date, body.ticker, "take", { key: body.stop, r: r(body.stop), bookR: r(BOOK_STOP) });
    } else {
      await saveDrillAnswer(userId, body.date, body.ticker, body.call as DrillCall);
    }
    const score = drillScore(await drillAnswers(userId));
    return NextResponse.json({ ok: true, score, stops });
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
