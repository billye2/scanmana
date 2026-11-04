import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { NAV_COOKIE, navCookieValue, parseNav } from "@/lib/nav";

export const dynamic = "force-dynamic";

/**
 * The top bar's picks (1.6.6). GET reads them, POST { keys: string[] } stores
 * them in a cookie for a year — per device by design: the phone and the desktop
 * can carry different bars. Validated by lib/nav.ts; nothing else is stored.
 */
export async function GET() {
  const store = await cookies();
  return NextResponse.json({ keys: parseNav(store.get(NAV_COOKIE)?.value) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { keys?: unknown } | null;
  if (!body || !Array.isArray(body.keys) || !body.keys.every((k) => typeof k === "string")) {
    return NextResponse.json({ error: "keys: string[] required" }, { status: 400 });
  }
  const value = navCookieValue(body.keys as string[]);
  const store = await cookies();
  // An empty pick is stored as a sentinel so it reads as an empty bar, not the default.
  store.set(NAV_COOKIE, value === "" ? "none" : value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  return NextResponse.json({ keys: parseNav(value) });
}
