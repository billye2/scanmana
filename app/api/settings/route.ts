import { NextResponse } from "next/server";
import { settingsSignature } from "@/lib/nav";
import { readSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The account's settings as one string (2.0.3). An open page asks for it when
 * it comes back to the foreground and redraws if another device changed the
 * bar or the text size (components/SettingsSync.tsx).
 */
export async function GET() {
  return NextResponse.json({ sig: settingsSignature(await readSettings()) }, { headers: { "cache-control": "no-store" } });
}
