import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let cached: Sql | null = null;

export function getSql(): Sql {
  if (!cached) {
    // COIL_DATABASE_URL is Scanmana's own Neon resource; the bare DATABASE_URL on
    // this Vercel project belongs to an unrelated earlier app — never use it.
    const url = process.env.COIL_DATABASE_URL;
    if (!url) throw new Error("COIL_DATABASE_URL is not set");
    cached = neon(url);
  }
  return cached;
}
