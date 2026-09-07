import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isPublicPath } from "@/lib/auth";

// Whole app behind Clerk sign-in (only allowlisted emails can sign in — set in
// the Clerk dashboard). Public paths pass straight through; unauthenticated
// API calls get a JSON 401, pages are sent to /sign-in and back afterwards.
export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return;
  const { userId, redirectToSignIn } = await auth();
  if (userId) return;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return redirectToSignIn({ returnBackUrl: req.url });
});

export const config = {
  // Everything except Next internals and static files with an extension (icons, sw.js, manifest are also whitelisted above).
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|ico|webmanifest|js)$).*)"],
};
