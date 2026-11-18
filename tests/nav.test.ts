import { describe, expect, it } from "vitest";
import { DEFAULT_NAV, MAX_NAV, NAV_SECTIONS, backAction, bottomBarLinks, navCookieValue, navSections, navStoredValue, parseNav, resolveSettings, settingsSignature } from "../lib/nav";

describe("backAction — the bottom bar's Back (1.8.4)", () => {
  it("goes back through history when the app got here by a tap", () => {
    expect(backAction(2)).toBe("back");
    expect(backAction(7)).toBe("back");
  });
  it("uses the fallback when the page was opened cold", () => {
    expect(backAction(1)).toBe("fallback");
    expect(backAction(0)).toBe("fallback");
  });
});

describe("bottomBarLinks — the home deck's bottom bar follows the picks", () => {
  it("takes the first four picks in order", () => {
    expect(bottomBarLinks(DEFAULT_NAV).map((s) => s.key)).toEqual(["deck", "paper", "gallery", "research"]);
    expect(bottomBarLinks(["watchlist", "help", "sim"]).map((s) => s.key)).toEqual(["watchlist", "help", "sim"]);
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

  it("draws the tape first when it is picked (1.9.9)", () => {
    expect(NAV_SECTIONS[0].key).toBe("tape");
    expect(parseNav("deck,paper,gallery,research,studies,tape")).toEqual(["tape", "deck", "paper", "gallery", "research", "studies"]);
    expect(bottomBarLinks(parseNav("deck,paper,gallery,research,studies,tape")).map((s) => s.key)).toEqual(["tape", "deck", "paper", "gallery"]);
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

describe("settings per account (2.0.3)", () => {
  it("the account's saved value wins over this device's cookie", () => {
    expect(resolveSettings({ nav: "tape,deck", text: "large" }, { nav: "help", text: "larger" })).toEqual({ nav: ["tape", "deck"], text: "large" });
  });
  it("a setting the account never saved falls back to the device, one by one", () => {
    expect(resolveSettings({ nav: null, text: "larger" }, { nav: "paper", text: null })).toEqual({ nav: ["paper"], text: "larger" });
    expect(resolveSettings(null, { nav: null, text: null })).toEqual({ nav: [...DEFAULT_NAV], text: "default" });
  });
  it("a saved default text size is a choice, not a gap", () => {
    expect(resolveSettings({ nav: null, text: "default" }, { nav: null, text: "larger" }).text).toBe("default");
  });
  it("an empty bar is stored as a sentinel and read back empty", () => {
    expect(navStoredValue([])).toBe("none");
    expect(resolveSettings({ nav: navStoredValue([]), text: null }, { nav: "deck", text: null }).nav).toEqual([]);
  });
  it("the signature changes when either setting does", () => {
    const a = settingsSignature({ nav: ["tape", "deck"], text: "default" });
    expect(settingsSignature({ nav: ["tape", "deck"], text: "default" })).toBe(a);
    expect(settingsSignature({ nav: ["tape"], text: "default" })).not.toBe(a);
    expect(settingsSignature({ nav: ["tape", "deck"], text: "large" })).not.toBe(a);
  });
});
