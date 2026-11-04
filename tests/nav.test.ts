import { describe, expect, it } from "vitest";
import { DEFAULT_NAV, MAX_NAV, NAV_SECTIONS, bottomBarLinks, navCookieValue, navSections, parseNav } from "../lib/nav";

describe("bottomBarLinks — the home deck's bottom bar follows the picks", () => {
  it("takes the first three picks, skipping the watchlist (the bar's star is the card's watch toggle)", () => {
    expect(bottomBarLinks(DEFAULT_NAV).map((s) => s.key)).toEqual(["deck", "paper", "gallery"]);
    expect(bottomBarLinks(["watchlist", "help", "sim"]).map((s) => s.key)).toEqual(["help", "sim"]);
    expect(bottomBarLinks([])).toEqual([]);
  });
});

describe("parseNav — the bar's picks from the cookie", () => {
  it("falls back to the default six when nothing is stored", () => {
    expect(parseNav(undefined)).toEqual(DEFAULT_NAV);
    expect(parseNav(null)).toEqual(DEFAULT_NAV);
    expect(parseNav("")).toEqual(DEFAULT_NAV);
  });

  it("keeps registry order whatever order the cookie has, drops unknown keys and duplicates", () => {
    expect(parseNav("help,deck,bogus,deck,gallery")).toEqual(["deck", "gallery", "help"]);
    expect(parseNav(" paper , research ")).toEqual(["paper", "research"]);
  });

  it("caps the picks at six, keeping the highest-ranked", () => {
    const all = NAV_SECTIONS.map((s) => s.key);
    expect(all.length).toBeGreaterThan(MAX_NAV);
    expect(parseNav(all.join(","))).toEqual(all.slice(0, MAX_NAV));
  });

  it("reads an explicit empty pick as an empty bar, not the default", () => {
    expect(parseNav("bogus")).toEqual([]);
    expect(parseNav([])).toEqual([]);
  });

  it("round-trips through the cookie value", () => {
    expect(navCookieValue(["sim", "deck", "nope"])).toBe("deck,sim");
    expect(parseNav(navCookieValue(DEFAULT_NAV))).toEqual(DEFAULT_NAV);
  });

  it("the default six are valid keys in registry order", () => {
    expect(parseNav([...DEFAULT_NAV])).toEqual(DEFAULT_NAV);
    expect(navSections(DEFAULT_NAV).map((s) => s.href)).toEqual(["/deck", "/paper", "/gallery", "/research", "/watchlist", "/s"]);
  });
});
