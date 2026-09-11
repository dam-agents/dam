// TEST_OVERVIEW: the contract's app router must be constructible — tRPC rejects
// TEST_OVERVIEW: reserved procedure names (apply, call, bind, then, …) only at
// TEST_OVERVIEW: router construction, which otherwise first happens at pod boot.
import { describe, expect, it } from "vitest";
import { appRouter } from "api-server-api/router";

describe("app router", () => {
  it("loads and exposes the starter-kits procedures", () => {
    const procedures = Object.keys(appRouter._def.procedures);
    expect(procedures).toEqual(
      expect.arrayContaining([
        "starterKits.list",
        "starterKits.get",
        "starterKits.onboarding",
        "starterKits.create",
      ]),
    );
  });
});
