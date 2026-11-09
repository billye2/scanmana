import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { TEXT_COOKIE, parseTextSize } from "@/lib/nav";

export const dynamic = "force-dynamic";

/**
 * The reader's text size (1.8.8). POST { size } stores it in a cookie for a year,
 * per device like the bar's picks (lib/nav.ts parseTextSize validates; anything
 * unknown is the default). The root layout reads the cookie on the next render.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { size?: unknown } | null;
  if (!body || typeof body.size !== "string") return NextResponse.json({ error: "size required" }, { status: 400 });
  const size = parseTextSize(body.size);
  const store = await cookies();
  if (size === "default") store.delete(TEXT_COOKIE);
  else store.set(TEXT_COOKIE, size, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  return NextResponse.json({ size });
}
