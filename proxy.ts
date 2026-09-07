import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthed, isPublicPath } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // no password configured (local dev) — open

  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (await isAuthed(req.cookies.get(AUTH_COOKIE)?.value, password)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next internals and static files with an extension (icons, sw.js, manifest are also whitelisted above).
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|ico|webmanifest|js)$).*)"],
};
