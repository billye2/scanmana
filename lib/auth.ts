// Single-password gate. The cookie holds an HMAC of a fixed label keyed by the
// password: it never reveals the password, and changing APP_PASSWORD logs every
// device out. No sessions table, no library.
export const AUTH_COOKIE = "scanmana_auth";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 365; // one year

/** Paths that must stay public: the cron (has its own secret), PWA install assets, the login flow itself. */
export const PUBLIC_PATHS = ["/login", "/api/login", "/api/cron/", "/manifest.webmanifest", "/sw.js", "/icons/", "/favicon.ico", "/_next/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

export async function sessionToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("scanmana-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string equality. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAuthed(cookieValue: string | undefined, password: string): Promise<boolean> {
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await sessionToken(password));
}

/** Only allow same-origin relative paths as a post-login destination. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
