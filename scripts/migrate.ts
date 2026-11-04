// Apply db/schema.sql to COIL_DATABASE_URL (injected from Vercel by `npm run migrate`).
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.COIL_DATABASE_URL;
  if (!url) throw new Error("COIL_DATABASE_URL is not set (Scanmana's own Neon DB — not the legacy DATABASE_URL)");
  const sql = neon(url);
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  // Comment lines are dropped before the split: a semicolon inside a comment would
  // otherwise cut a statement in two (mistakes.md 2026-11-03). Trailing comments on a
  // statement line are not handled — keep comments on their own lines.
  const statements = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sql.query(stmt);
    console.log("ok:", stmt.split("\n")[0]);
  }
  console.log("migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
