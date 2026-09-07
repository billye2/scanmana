import { NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_MAX_AGE, safeEqual, safeNext, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const expected = process.env.APP_PASSWORD;
  const form = await req.formData();
  const given = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));

  if (!expected || !safeEqual(given, expected)) {
    const back = new URL("/login", req.url);
    back.searchParams.set("error", "1");
    back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(AUTH_COOKIE, await sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}
