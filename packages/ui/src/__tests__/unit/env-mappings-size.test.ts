import { describe, expect,it } from "vitest";

import {
  ENV_MAPPINGS_MAX_BYTES,
  validateEnvMappingsSize,
} from "../../modules/secrets/utils/env-mappings-size.js";

describe("validateEnvMappingsSize (ADR-040)", () => {
  it("accepts an empty mappings list", () => {
    expect(validateEnvMappingsSize([])).toEqual({ ok: true });
  });

  it("accepts a small typical envMappings list", () => {
    const result = validateEnvMappingsSize([
      { envName: "ANTHROPIC_API_KEY", placeholder: "dummy-placeholder" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects an oversized payload and reports both bytes and limit", () => {
    // Build a payload comfortably above the cap by repeating a long
    // placeholder. envMappingSchema permits placeholder up to 1000 chars.
    const huge = Array.from({ length: 200 }, (_, i) => ({
      envName: `BIG_VAR_${String(i).padStart(3, "0")}`,
      placeholder: "x".repeat(1000),
    }));
    const result = validateEnvMappingsSize(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.bytes).toBeGreaterThan(ENV_MAPPINGS_MAX_BYTES);
    expect(result.limit).toBe(ENV_MAPPINGS_MAX_BYTES);
  });
});
