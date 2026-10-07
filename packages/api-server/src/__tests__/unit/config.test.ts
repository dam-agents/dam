import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentsInstallSettings, loadConfig } from "../../config.js";

const REQUIRED_ENV: Record<string, string> = {
  PLATFORM_RELEASE_NAME: "platform",
  PLATFORM_HARNESS_SERVER_URL: "http://harness.local:8080",
  DATABASE_URL: "postgres://localhost:5432/test",
  ACTIVITY_HMAC_KEY: "test-activity-hmac-key",
  API_KEY_HMAC_KEY: "test-api-hmac-key",
  SHARE_BASE_URL: "http://share.localhost:4444",
  CONTENT_BASE_URL: "http://content.localhost:4444",
  TERMS_VERSION: "1",
  TERMS_TEXT: "terms",
};

const MANAGED_KEYS = [
  ...Object.keys(REQUIRED_ENV),
  "APPROVAL_HOLD_SECONDS",
  "ACP_TURN_STALL_PROBE_SECONDS",
];

describe("loadConfig — turn watch invariants", () => {
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

  it("raises a stall probe below the approval hold to the hold", () => {
    process.env.APPROVAL_HOLD_SECONDS = "3600";
    process.env.ACP_TURN_STALL_PROBE_SECONDS = "1800";
    expect(loadConfig().acpTurnStallProbeSeconds).toBe(3600);
  });

  it("accepts the built-in defaults (30m probe, 30m hold)", () => {
    const config = loadConfig();
    expect(config.approvalHoldSeconds).toBe(1800);
    expect(config.acpTurnStallProbeSeconds).toBe(1800);
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

describe("agentsInstallSettings — what every agents module is built with", () => {
  const managed = [
    ...Object.keys(REQUIRED_ENV),
    "RUNTIME_MIGRATION_RETENTION",
    "AGENT_DEFAULT_STORAGE_SIZE",
    "VIRTUALIZATION_ENABLED",
    "AGENT_DEFAULT_MOUNTS",
  ];
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

  // TEST_SCENARIO: the chart sets the retention window on the api-server as a Go duration. Every composition root takes the agents module's install facts from this one reading, so the migration plan the UI gets names the install's window, disk default and default mounts rather than none.
  it("carries the chart's retention window, disk default and default mounts", () => {
    process.env.RUNTIME_MIGRATION_RETENTION = "72h";
    process.env.AGENT_DEFAULT_STORAGE_SIZE = "20Gi";
    process.env.VIRTUALIZATION_ENABLED = "true";
    expect(agentsInstallSettings(loadConfig())).toEqual({
      virtualizationEnabled: true,
      agentDefaultStorageSize: "20Gi",
      agentDefaultMounts: [
        { path: "/home/agent", persist: true },
        { path: "/tmp", persist: false },
      ],
      runtimeMigrationRetentionMs: 72 * 3600_000,
    });
  });

  it("defaults the retention window to a week", () => {
    expect(
      agentsInstallSettings(loadConfig()).runtimeMigrationRetentionMs,
    ).toBe(7 * 24 * 3600_000);
  });

  // TEST_SCENARIO: the controller keeps a volume whose window it cannot read, so the api-server must not invent one either.
  it("reads a retention window it cannot parse as unknown", () => {
    process.env.RUNTIME_MIGRATION_RETENTION = "7d";
    expect(
      agentsInstallSettings(loadConfig()).runtimeMigrationRetentionMs,
    ).toBeNull();
  });
});

describe("loadConfig — runtime migration inputs", () => {
  const KEYS = ["VIRTUALIZATION_ENABLED", "AGENT_DEFAULT_MOUNTS"];
  const managed = [...Object.keys(REQUIRED_ENV), ...KEYS];
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

  // TEST_SCENARIO: an install that writes VIRTUALIZATION_ENABLED=false has no VM runner. Reading any non-empty string as true would offer the migration there and flip Agents onto a backend nothing runs.
  it("reads VIRTUALIZATION_ENABLED as the boolean it spells", () => {
    expect(loadConfig().virtualizationEnabled).toBe(false);
    process.env.VIRTUALIZATION_ENABLED = "false";
    expect(loadConfig().virtualizationEnabled).toBe(false);
    process.env.VIRTUALIZATION_ENABLED = "true";
    expect(loadConfig().virtualizationEnabled).toBe(true);
  });

  // TEST_SCENARIO: the runtime migration plans from the template default mounts the controller renders for an Agent that names none. Without the chart's value the api-server falls back to the chart's own default, HOME persisted and /tmp not.
  it("reads the template default mounts the chart hands over", () => {
    expect(loadConfig().agentDefaultMounts).toEqual([
      { path: "/home/agent", persist: true },
      { path: "/tmp", persist: false },
    ]);
    process.env.AGENT_DEFAULT_MOUNTS = JSON.stringify([
      { path: "/home/agent", persist: true },
      { path: "/data", persist: true, size: "5Gi" },
    ]);
    expect(loadConfig().agentDefaultMounts).toEqual([
      { path: "/home/agent", persist: true },
      { path: "/data", persist: true, size: "5Gi" },
    ]);
  });
});
