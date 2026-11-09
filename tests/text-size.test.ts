import { describe, expect, it } from "vitest";
import { TEXT_SIZES, parseTextSize } from "../lib/nav";

describe("parseTextSize — the reader's text size from the cookie (1.8.8)", () => {
  it("reads the three sizes", () => {
    expect(parseTextSize("default")).toBe("default");
    expect(parseTextSize("large")).toBe("large");
    expect(parseTextSize("larger")).toBe("larger");
  });
  it("falls back to default on anything else", () => {
    expect(parseTextSize(undefined)).toBe("default");
    expect(parseTextSize(null)).toBe("default");
    expect(parseTextSize("")).toBe("default");
    expect(parseTextSize("huge")).toBe("default");
    expect(parseTextSize("LARGE")).toBe("default");
  });
  it("the registry lists every size once, default first", () => {
    expect(TEXT_SIZES.map((s) => s.key)).toEqual(["default", "large", "larger"]);
    expect(new Set(TEXT_SIZES.map((s) => s.label)).size).toBe(TEXT_SIZES.length);
  });
});
