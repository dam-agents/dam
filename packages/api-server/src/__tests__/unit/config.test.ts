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
  SHARE_BASE_URL: "http://share.localhost:4444",
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

describe("loadConfig — object storage", () => {
  const OBJECT_KEYS = [
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_REGION",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY_ID",
    "OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "OBJECT_STORAGE_FORCE_PATH_STYLE",
    "MAX_ARTIFACT_BYTES",
  ];
  const managed = [...Object.keys(REQUIRED_ENV), ...OBJECT_KEYS];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of managed) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const k of managed) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults the artifact cap to 50 MiB and the store group sanely", () => {
    process.env.OBJECT_STORAGE_ENDPOINT = "http://seaweedfs:8333";
    const config = loadConfig();
    expect(config.objectStorageEndpoint).toBe("http://seaweedfs:8333");
    expect(config.maxArtifactBytes).toBe(50 * 1024 * 1024);
    expect(config.objectStorageBucket).toBe("platform-artifacts");
    expect(config.objectStorageForcePathStyle).toBe(true);
  });

  it("lets an explicit MAX_ARTIFACT_BYTES win over the default", () => {
    process.env.OBJECT_STORAGE_ENDPOINT = "http://seaweedfs:8333";
    process.env.MAX_ARTIFACT_BYTES = "1048576";
    expect(loadConfig().maxArtifactBytes).toBe(1048576);
  });

  it("parses FORCE_PATH_STYLE=false as a real false", () => {
    process.env.OBJECT_STORAGE_ENDPOINT = "https://s3.us-east-1.amazonaws.com";
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = "false";
    expect(loadConfig().objectStorageForcePathStyle).toBe(false);
  });

  it("rejects half a credential pair", () => {
    process.env.OBJECT_STORAGE_ENDPOINT = "http://seaweedfs:8333";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "platform";
    expect(() => loadConfig()).toThrow(/must be set together/);
  });
});
