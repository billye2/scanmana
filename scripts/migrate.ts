// Apply db/schema.sql to COIL_DATABASE_URL (injected from Vercel by `npm run migrate`).
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.COIL_DATABASE_URL;
  if (!url) throw new Error("COIL_DATABASE_URL is not set (Scanmana's own Neon DB — not the legacy DATABASE_URL)");
  const sql = neon(url);
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const statements = schema
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
