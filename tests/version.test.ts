import { describe, expect, it } from "vitest";
import { bumpVersion } from "../scripts/version-lib.mjs";
import { APP_VERSION } from "../lib/version";
import { version as pkgVersion } from "../package.json";

describe("versioning", () => {
  it("counts each segment 0-9 with roll-over (taskmana-mobile scheme)", () => {
    expect(bumpVersion("1.0.0")).toBe("1.0.1");
    expect(bumpVersion("1.0.9")).toBe("1.1.0");
    expect(bumpVersion("1.9.9")).toBe("2.0.0");
    expect(() => bumpVersion("1.10.0")).toThrow();
  });

  it("package.json and the visible version line agree", () => {
    expect(APP_VERSION).toBe(pkgVersion);
  });
});
