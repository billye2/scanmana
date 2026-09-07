import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { CONFIG } from "@/lib/config";
import { loadBars } from "@/lib/scan";
import { buildCandidate } from "@/lib/screen";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  const rows = await sql`
    SELECT ticker, added_at, box_top AS "boxTop", box_bottom AS "boxBottom"
    FROM watchlist ORDER BY added_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const rawTicker = body.ticker;
  if (typeof rawTicker !== "string" || !rawTicker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  const ticker = rawTicker.toUpperCase();
  let { boxTop, boxBottom } = body as { boxTop?: number | null; boxBottom?: number | null };
  // Hand-added (no box fields sent, e.g. the watchlist Add form): derive
  // trigger/stop from stored bars the same way a deck card would carry them.
  if (!("boxTop" in body)) {
    const bars = (await loadBars([ticker])).get(ticker) ?? [];
    if (bars.length === 0) {
      return NextResponse.json({ error: `no price history stored for ${ticker}` }, { status: 404 });
    }
    const c = buildCandidate(ticker, ticker, bars);
    boxTop = c?.box?.top ?? c?.pivot ?? null;
    boxBottom = c?.box?.bottom ?? null;
  }
  const sql = getSql();
  const [{ n }] = (await sql`
    SELECT count(*)::int AS n FROM watchlist WHERE ticker <> ${ticker}
  `) as { n: number }[];
  if (n >= CONFIG.WATCHLIST_CAP) {
    return NextResponse.json(
      { error: `watchlist is full (${CONFIG.WATCHLIST_CAP}) — the live view's quote budget; remove something first` },
      { status: 409 },
    );
  }
  await sql`
    INSERT INTO watchlist (ticker, box_top, box_bottom)
    VALUES (${ticker}, ${boxTop ?? null}, ${boxBottom ?? null})
    ON CONFLICT (ticker) DO UPDATE SET box_top = EXCLUDED.box_top, box_bottom = EXCLUDED.box_bottom
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { ticker } = await req.json();
  if (typeof ticker !== "string" || !ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  const sql = getSql();
  await sql`DELETE FROM watchlist WHERE ticker = ${ticker}`;
  return NextResponse.json({ ok: true });
}
