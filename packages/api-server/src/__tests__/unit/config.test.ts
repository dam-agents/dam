import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../config.js";

/** Every config field with no default, set to a valid dummy so loadConfig()
 *  reaches the acpTurnCeilingSeconds >= approvalHoldSeconds refine. Individual
 *  cases layer the two timer knobs on top. */
const REQUIRED_ENV: Record<string, string> = {
  PLATFORM_RELEASE_NAME: "platform",
  PLATFORM_HARNESS_SERVER_URL: "http://harness.local:8080",
  DATABASE_URL: "postgres://localhost:5432/test",
  ACTIVITY_HMAC_KEY: "test-activity-hmac-key",
  API_KEY_HMAC_KEY: "test-api-hmac-key",
  TERMS_VERSION: "1",
  TERMS_TEXT: "terms",
};

// Only the keys these tests touch are saved/restored, so host env can't
// satisfy or violate the invariant under test and the suite leaves env pristine.
const MANAGED_KEYS = [
  ...Object.keys(REQUIRED_ENV),
  "APPROVAL_HOLD_SECONDS",
  "ACP_TURN_CEILING_SECONDS",
];

describe("loadConfig — acpTurnCeilingSeconds vs approvalHoldSeconds invariant", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of MANAGED_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const k of MANAGED_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("rejects a ceiling below the approval hold", () => {
    process.env.APPROVAL_HOLD_SECONDS = "1800";
    process.env.ACP_TURN_CEILING_SECONDS = "60";
    expect(() => loadConfig()).toThrow(
      /acpTurnCeilingSeconds must be >= approvalHoldSeconds/,
    );
  });

  it("accepts a ceiling equal to the approval hold", () => {
    process.env.APPROVAL_HOLD_SECONDS = "1800";
    process.env.ACP_TURN_CEILING_SECONDS = "1800";
    expect(loadConfig().acpTurnCeilingSeconds).toBe(1800);
  });

  it("accepts the built-in defaults (1h ceiling, 30m hold)", () => {
    const config = loadConfig();
    expect(config.approvalHoldSeconds).toBe(1800);
    expect(config.acpTurnCeilingSeconds).toBe(3600);
  });
});
