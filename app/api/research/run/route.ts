import { NextResponse } from "next/server";
import { triggerResearch } from "@/lib/research";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Backs the Refresh button on /research: runs every research job now (force), waits for the result. */
export async function POST(req: Request) {
  const force = new URL(req.url).searchParams.get("force") !== "0";
  return NextResponse.json(await triggerResearch({ force, budget: 270 }));
}
