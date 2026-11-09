// The drill's persistence (1.8.5). Draws a scored deck row the reader has not
// called yet, stores each call, and reads the calls back with their outcomes so
// lib/drill.ts can grade them. Everything goes through getSql() so the
// COIL_DATABASE_URL rule in lib/db.ts holds. Readers return empty shapes before
// the table exists, the writer throws.
import { CONFIG } from "./config";
import type { DrillAnswer, DrillCall } from "./drill";
import { GALLERY_BEFORE_DAYS, galleryRowFromSql, type GalleryRow, type GalleryRowSql } from "./gallery";
import { getSql } from "./db";

/**
 * One scored deck row at random that this reader has not called, from a scan night
 * whose bars before it are still in the store (bars are pruned after
 * CONFIG.PRUNE_DAYS, the chart wants GALLERY_BEFORE_DAYS before the night), and not
 * one of the tickers in the reader's last CONFIG.DRILL.RECENT_TICKERS calls — a
 * runner sits on the deck for many nights and the second look would be from memory.
 * Null when every chart has been called or nothing is scored yet.
 */
export async function nextDrillRow(userId: string): Promise<GalleryRow | null> {
  try {
    const sql = getSql();
    const rows = (await sql`
      SELECT h.date::text AS date, h.ticker, h.close, h.verdict, h.boxed, h.box_top, h.box_bottom, h.pivot, h.adr_pct, h.tightness,
             h.dist_from_high, h.ret_1m, h.ret_3m, h.ret_6m, h.market_bullish,
             o.mfe_20, o.mae_20, o.broke_10d, o.broke_day, o.k_r, o.k_stop_adr, o.k_entry_day
      FROM scan_history h JOIN research_outcomes o USING (date, ticker)
      WHERE h.rank IS NOT NULL AND o.complete AND o.mfe_20 IS NOT NULL
        AND h.date >= CURRENT_DATE - ${CONFIG.PRUNE_DAYS - GALLERY_BEFORE_DAYS}::int
        AND NOT EXISTS (SELECT 1 FROM drill_answers a WHERE a.user_id = ${userId} AND a.date = h.date AND a.ticker = h.ticker)
        AND h.ticker NOT IN (
          SELECT ticker FROM drill_answers WHERE user_id = ${userId} ORDER BY answered_at DESC LIMIT ${CONFIG.DRILL.RECENT_TICKERS}
        )
      ORDER BY random()
      LIMIT 1
    `) as GalleryRowSql[];
    return rows[0] ? galleryRowFromSql(rows[0]) : null;
  } catch {
    return null;
  }
}

/** The reader's calls with the rows they were made on, newest first. Empty before the first call or the migration. */
export async function drillAnswers(userId: string): Promise<DrillAnswer[]> {
  try {
    const sql = getSql();
    const rows = (await sql`
      SELECT a.call,
             h.date::text AS date, h.ticker, h.close, h.verdict, h.boxed, h.box_top, h.box_bottom, h.pivot, h.adr_pct, h.tightness,
             h.dist_from_high, h.ret_1m, h.ret_3m, h.ret_6m, h.market_bullish,
             o.mfe_20, o.mae_20, o.broke_10d, o.broke_day, o.k_r, o.k_stop_adr, o.k_entry_day
      FROM drill_answers a
      JOIN scan_history h ON h.date = a.date AND h.ticker = a.ticker
      JOIN research_outcomes o ON o.date = a.date AND o.ticker = a.ticker
      WHERE a.user_id = ${userId} AND o.mfe_20 IS NOT NULL
      ORDER BY a.answered_at DESC
      LIMIT 5000
    `) as (GalleryRowSql & { call: DrillCall })[];
    return rows.map((r) => ({ call: r.call, row: galleryRowFromSql(r) }));
  } catch {
    return [];
  }
}

/**
 * Store one call. The first call on a chart stands: a second POST for the same
 * (reader, night, ticker) — a double tap, a retried request — changes nothing.
 */
export async function saveDrillAnswer(userId: string, date: string, ticker: string, call: DrillCall): Promise<void> {
  await getSql()`
    INSERT INTO drill_answers (user_id, date, ticker, call)
    VALUES (${userId}, ${date}::date, ${ticker}, ${call})
    ON CONFLICT (user_id, date, ticker) DO NOTHING
  `;
}

/** Forget every call this reader made — the "start over" on the page. */
export async function clearDrillAnswers(userId: string): Promise<void> {
  await getSql()`DELETE FROM drill_answers WHERE user_id = ${userId}`;
}
