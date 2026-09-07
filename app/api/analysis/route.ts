import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/analysis?ticker=XHLD&date=2026-08-31 → stored Analysis (latest date if omitted). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  const date = url.searchParams.get("date");
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  const sql = getSql();
  const rows = (date
    ? await sql`SELECT analysis FROM analyses WHERE ticker = ${ticker} AND date = ${date}`
    : await sql`SELECT analysis FROM analyses WHERE ticker = ${ticker} ORDER BY date DESC LIMIT 1`) as { analysis: unknown }[];
  if (rows.length === 0) return NextResponse.json({ error: "no analysis stored" }, { status: 404 });
  return NextResponse.json(rows[0].analysis);
}
