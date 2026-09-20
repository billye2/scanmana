import { NextResponse } from "next/server";
import { setSplitStatus } from "@/lib/research";

export const dynamic = "force-dynamic";

/** Confirm or dismiss a detected split. Body: { ticker, date, status: "auto" | "review" | "ignored" }. 'auto' rows adjust the bars the scan sees. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ticker?: string; date?: string; status?: string } | null;
  if (!body?.ticker || !body.date || !["auto", "review", "ignored"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "ticker, date and a valid status required" }, { status: 400 });
  }
  await setSplitStatus(body.ticker, body.date, body.status as "auto" | "review" | "ignored");
  return NextResponse.json({ ok: true });
}
