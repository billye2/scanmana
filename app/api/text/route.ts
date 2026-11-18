import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { TEXT_COOKIE, parseTextSize } from "@/lib/nav";
import { readSettings, saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The reader's text size (1.8.8). POST { size } stores it on the account
 * (2.0.3), like the bar's picks, and in this device's cookie as the fallback
 * (lib/nav.ts parseTextSize validates; anything unknown is the default). The
 * root layout reads it on the next render.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { size?: unknown } | null;
  if (!body || typeof body.size !== "string") return NextResponse.json({ error: "size required" }, { status: 400 });
  const size = parseTextSize(body.size);
  const store = await cookies();
  if (size === "default") store.delete(TEXT_COOKIE);
  else store.set(TEXT_COOKIE, size, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  const { userId } = await readSettings();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    // "default" is stored as a value: a null column would hand the choice back to each device's cookie.
    await saveSettings(userId, { text: size });
  } catch {
    return NextResponse.json({ error: "saved on this device only; the account could not be reached" }, { status: 500 });
  }
  return NextResponse.json({ size });
}
