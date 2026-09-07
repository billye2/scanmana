import { describe, expect, it } from "vitest";
import { isAuthed, isPublicPath, safeEqual, safeNext, sessionToken } from "../lib/auth";

describe("auth", () => {
  it("derives a stable token that changes with the password and never contains it", async () => {
    const a = await sessionToken("hunter2");
    expect(a).toBe(await sessionToken("hunter2"));
    expect(a).not.toBe(await sessionToken("hunter3"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("hunter");
  });
  it("accepts only the matching cookie", async () => {
    const t = await sessionToken("pw");
    expect(await isAuthed(t, "pw")).toBe(true);
    expect(await isAuthed(t, "other")).toBe(false);
    expect(await isAuthed(undefined, "pw")).toBe(false);
    expect(await isAuthed("", "pw")).toBe(false);
  });
  it("keeps the cron, PWA assets and login public, everything else gated", () => {
    for (const p of ["/login", "/api/login", "/api/cron/scan", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/watchlist", "/s/PLSE", "/api/analysis", "/api/watchlist", "/api/scan/run", "/api/push/subscribe", "/help"]) expect(isPublicPath(p)).toBe(false);
  });
  it("only redirects to same-origin paths after login", () => {
    expect(safeNext("/watchlist")).toBe("/watchlist");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
  it("compares in constant time without leaking length equality shortcuts", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});
