import { describe, expect, test } from "vitest";

import {
  becomesPublic,
  publicShareMessage,
} from "../../modules/artifacts/lib/public-share.js";

describe("becomesPublic", () => {
  test("true when visibility changes to public", () => {
    expect(becomesPublic("private", "public")).toBe(true);
    expect(becomesPublic("restricted", "public")).toBe(true);
  });

  test("false when already public or moving away from public", () => {
    expect(becomesPublic("public", "public")).toBe(false);
    expect(becomesPublic("public", "restricted")).toBe(false);
    expect(becomesPublic("public", "private")).toBe(false);
  });
});

describe("publicShareMessage", () => {
  test("names the vendor when the brand has one", () => {
    expect(publicShareMessage("Acme")).toContain("people outside of Acme");
  });

  test("skips the vendor sentence when the brand has none", () => {
    expect(publicShareMessage("")).not.toContain("outside of");
  });
});
