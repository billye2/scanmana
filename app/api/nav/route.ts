import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { NAV_COOKIE, navStoredValue, parseNav } from "@/lib/nav";
import { readSettings, saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The top bar's picks (1.6.6). GET reads them, POST { keys: string[] } stores
 * them on the account (2.0.3: one bar for every device signed in with it) and
 * in this device's cookie, which is only the fallback when the account row
 * cannot be read. Validated by lib/nav.ts; nothing else is stored.
 */
export async function GET() {
  return NextResponse.json({ keys: (await readSettings()).nav });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { keys?: unknown } | null;
  if (!body || !Array.isArray(body.keys) || !body.keys.every((k) => typeof k === "string")) {
    return NextResponse.json({ error: "keys: string[] required" }, { status: 400 });
  }
  const value = navStoredValue(body.keys as string[]);
  const store = await cookies();
  store.set(NAV_COOKIE, value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  const { userId } = await readSettings();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    await saveSettings(userId, { nav: value });
  } catch {
    return NextResponse.json({ error: "saved on this device only; the account could not be reached" }, { status: 500 });
  }
  return NextResponse.json({ keys: parseNav(value) });
}
