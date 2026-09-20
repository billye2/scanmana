// Sign-in is Clerk (see proxy.ts). This module only decides which paths stay
// public: the cron and the research job (each checks its own secret), PWA
// install assets, and Clerk's sign-in route itself.
export const PUBLIC_PATHS = ["/sign-in", "/sign-in/", "/api/cron/", "/api/research_job", "/manifest.webmanifest", "/sw.js", "/icons/", "/favicon.ico", "/_next/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}
