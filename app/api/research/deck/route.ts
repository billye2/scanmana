import { NextResponse } from "next/server";
import { deckResearch } from "@/lib/research";
import { latestScan } from "@/lib/scan";

export const dynamic = "force-dynamic";

/** Per-card research for tonight's deck: "setups like this" hit rate and the theme cluster. Clerk-gated like every /api route. */
export async function GET() {
  try {
    const payload = await latestScan();
    if (!payload) return NextResponse.json({});
    const cards = payload.candidates.map((c) => ({ ticker: c.ticker, boxed: !!c.box, ep: !!c.ep, verdict: c.verdict ?? "wait" }));
    return NextResponse.json(await deckResearch(cards));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
