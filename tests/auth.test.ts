import { describe, expect, it } from "vitest";
import { isPublicPath } from "../lib/auth";

describe("auth", () => {
  it("keeps the cron, PWA assets and the sign-in route public, everything else gated", () => {
    for (const p of ["/sign-in", "/sign-in/factor-one", "/api/cron/scan", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/login", "/watchlist", "/s/PLSE", "/api/analysis", "/api/watchlist", "/api/scan/run", "/api/push/subscribe", "/help"]) expect(isPublicPath(p)).toBe(false);
  });
});
