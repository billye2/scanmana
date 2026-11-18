// The reader's settings, per account (2.0.3): the bar's picks and the text size
// follow the sign-in, so the phone's home-screen app and every browser show the
// same thing. One row per Clerk user in user_settings; a column left null has
// never been saved, and that setting falls back to this device's cookie (the
// only store before 2.0.3). Everything goes through getSql() so the
// COIL_DATABASE_URL rule in lib/db.ts holds.
import { cache } from "react";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { getSql } from "./db";
import { NAV_COOKIE, TEXT_COOKIE, resolveSettings, type Settings, type StoredSettings } from "./nav";

/** The signed-in reader, or null on a public path or where the proxy did not run. */
async function currentUserId(): Promise<string | null> {
  try {
    return (await auth()).userId ?? null;
  } catch {
    return null;
  }
}

async function readRow(userId: string): Promise<StoredSettings | null> {
  try {
    const sql = getSql();
    const rows = (await sql`SELECT nav, text_size FROM user_settings WHERE user_id = ${userId}`) as { nav: string | null; text_size: string | null }[];
    return rows[0] ? { nav: rows[0].nav, text: rows[0].text_size } : null;
  } catch {
    // Before the migration, or with the database down: the device's cookies still draw the page.
    return null;
  }
}

/**
 * The settings this request renders with: the account's row first, this
 * device's cookies for anything the account has not saved. Cached per request,
 * so the root layout, the top bar and the page share one query.
 */
export const readSettings = cache(async (): Promise<Settings & { userId: string | null }> => {
  const store = await cookies();
  const device: StoredSettings = { nav: store.get(NAV_COOKIE)?.value ?? null, text: store.get(TEXT_COOKIE)?.value ?? null };
  const userId = await currentUserId();
  const row = userId ? await readRow(userId) : null;
  return { ...resolveSettings(row, device), userId };
});

/** Store one or both settings on the account. Throws when the write fails, so the caller can say so. */
export async function saveSettings(userId: string, patch: { nav?: string; text?: string }): Promise<void> {
  const sql = getSql();
  const nav = patch.nav ?? null;
  const text = patch.text ?? null;
  await sql`
    INSERT INTO user_settings (user_id, nav, text_size) VALUES (${userId}, ${nav}, ${text})
    ON CONFLICT (user_id) DO UPDATE SET
      nav = COALESCE(EXCLUDED.nav, user_settings.nav),
      text_size = COALESCE(EXCLUDED.text_size, user_settings.text_size),
      updated_at = now()
  `;
}
