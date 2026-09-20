import { NextResponse } from "next/server";
import { setClusterAlias } from "@/lib/research";

export const dynamic = "force-dynamic";

/** Name a theme cluster (Python only groups; the name is yours). Body: { clusterKey, alias } — empty alias removes it. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { clusterKey?: string; alias?: string } | null;
  if (!body?.clusterKey || typeof body.alias !== "string") {
    return NextResponse.json({ error: "clusterKey and alias required" }, { status: 400 });
  }
  await setClusterAlias(body.clusterKey, body.alias);
  return NextResponse.json({ ok: true });
}
