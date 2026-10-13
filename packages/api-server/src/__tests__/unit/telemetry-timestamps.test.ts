import { describe, expect, it } from "vitest";

import { toIsoUtc } from "../../modules/telemetry/index.js";

/**
 * TEST_OVERVIEW: the store renders DateTime64 without a zone, which the client
 * would read as local time and the contract would reject outright, so every
 * timestamp leaving the reader is normalized to ISO-8601 UTC first.
 */

describe("toIsoUtc", () => {
  it("stamps the store's zone-less timestamp as UTC", () => {
    expect(toIsoUtc("2026-09-14 11:22:33.123456789")).toBe(
      "2026-09-14T11:22:33.123456789Z",
    );
  });

  it("handles a whole-second timestamp", () => {
    expect(toIsoUtc("2026-09-14 11:22:33")).toBe("2026-09-14T11:22:33Z");
  });

  it("passes an already-ISO timestamp through untouched", () => {
    expect(toIsoUtc("2026-09-14T11:22:33.123Z")).toBe(
      "2026-09-14T11:22:33.123Z",
    );
  });

  it("leaves an offset-bearing timestamp alone rather than double-stamping it", () => {
    expect(toIsoUtc("2026-09-14T13:22:33+02:00")).toBe(
      "2026-09-14T13:22:33+02:00",
    );
  });

  it("survives an empty or absent value", () => {
    expect(toIsoUtc("")).toBe("");
    expect(toIsoUtc(null)).toBe("");
    expect(toIsoUtc(undefined)).toBe("");
  });
});
