import { readFileSync } from "node:fs";
import { load } from "js-yaml";
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

describe("loadConfig — version", () => {
  const managed = [...Object.keys(REQUIRED_ENV), "PLATFORM_APP_VERSION"];
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

  it("recommends the CLI of a tagged release", () => {
    process.env.PLATFORM_APP_VERSION = "0.2.24";
    expect(loadConfig()).toMatchObject({
      appVersion: "0.2.24",
      recommendedClientCliVersion: "0.2.24",
    });
    process.env.PLATFORM_APP_VERSION = "0.2.24-rc3";
    expect(loadConfig().recommendedClientCliVersion).toBe("0.2.24-rc3");
  });

  // TEST_SCENARIO: CD stamps a build from main `<version>-dev-<sha>`, a version npm never publishes. Recommending it would warn every CLI that is behind a release nobody can install.
  it("recommends no CLI for a build from main", () => {
    process.env.PLATFORM_APP_VERSION = "0.2.24-dev-db35e8abf4bd";
    const config = loadConfig();
    expect(config.appVersion).toBe("0.2.24-dev-db35e8abf4bd");
    expect(config.recommendedClientCliVersion).toBeUndefined();
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
    "AGENT_DEFAULT_STORAGE_SIZE",
    "VIRTUALIZATION_ENABLED",
    "FEATURE_MODES",
    "FEATURE_DEFAULT_MODE",
    "CURVE_BENDER_DEPLOYMENT_API_KEY",
    "AGENT_DEFAULT_MOUNTS",
    "HARNESSES",
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

  // TEST_SCENARIO: the chart sets the disk default and default mounts on the api-server. Every composition root takes the agents module's install facts from this one reading, so the migration decision names the install's disk default and default mounts rather than none.
  it("carries the chart's disk default and default mounts", () => {
    process.env.AGENT_DEFAULT_STORAGE_SIZE = "20Gi";
    process.env.VIRTUALIZATION_ENABLED = "true";
    expect(agentsInstallSettings(loadConfig())).toEqual({
      virtualizationEnabled: true,
      defaultHarness: "claude-code",
      telemetry: false,
      agentDefaultStorageSize: "20Gi",
      agentDefaultMounts: [
        { path: "/home/agent", persist: true },
        { path: "/tmp", persist: false },
      ],
    });
  });

  // TEST_SCENARIO: an operator sets the install's default mode off and pins one feature on. Every feature the chart does not name takes the default; without a default each unnamed feature stays experimental.
  it("reads every feature the chart does not name as the default mode", () => {
    expect(loadConfig().featureModes["agent-telemetry"]).toBe("experimental");
    process.env.FEATURE_DEFAULT_MODE = "off";
    process.env.FEATURE_MODES = JSON.stringify({ "agent-telemetry": "on" });
    expect(loadConfig().featureModes).toMatchObject({
      "agent-telemetry": "on",
      "custom-avatars": "off",
    });
  });

  // TEST_SCENARIO: the deployment's CurveBender is offered only where the install sets its key; without one the install configures no shared CurveBender rather than failing the boot.
  it("offers the deployment CurveBender only with its key", () => {
    expect(loadConfig().curveBenderDeployment).toBeNull();
    process.env.CURVE_BENDER_DEPLOYMENT_API_KEY = "sk-deployment";
    expect(loadConfig().curveBenderDeployment).toEqual({
      apiKey: "sk-deployment",
    });
  });

  // TEST_SCENARIO: the chart's own price list is what every install boots with, so each row must pass the config schema.
  it("accepts the chart's price list", () => {
    const values = load(
      readFileSync(
        new URL("../../../../../helm/values.yaml", import.meta.url),
        "utf8",
      ),
    ) as { apiServer: { spend: { priceOverrides: unknown[] } } };
    process.env.SPEND_PRICE_OVERRIDES = JSON.stringify(
      values.apiServer.spend.priceOverrides,
    );
    try {
      expect(loadConfig().spendPriceOverrides).toContainEqual(
        expect.objectContaining({
          provider: "ibm-litellm",
          model: "aws/claude-opus-5-5",
        }),
      );
    } finally {
      delete process.env.SPEND_PRICE_OVERRIDES;
    }
  });

  /** TEST_SCENARIO: The chart names the harness new agents start on, and any
   * harness with an export rail means new agents carry their name for
   * telemetry. */
  it("carries the chart's default harness and whether telemetry is on", () => {
    process.env.HARNESSES = JSON.stringify({
      default: "codex",
      catalog: {
        codex: { displayName: "Codex" },
        bob: {
          displayName: "Bob",
          telemetryEnv: [{ name: "BOB_TELEMETRY_URL", value: "https://c" }],
        },
      },
    });
    expect(agentsInstallSettings(loadConfig())).toMatchObject({
      defaultHarness: "codex",
      telemetry: true,
    });
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

describe("loadConfig — backchannel addresses", () => {
  const BACKCHANNEL_ENV: Record<string, string> = {
    BACKCHANNEL_UI_BASE_URL: "http://localhost:4444",
    BACKCHANNEL_KEYCLOAK_URL: "http://keycloak.localhost:4444",
    BACKCHANNEL_SHARE_BASE_URL: "http://share.localhost:4444",
    BACKCHANNEL_CONTENT_BASE_URL: "http://content.localhost:4444",
  };
  const managed = [
    ...Object.keys(REQUIRED_ENV),
    ...Object.keys(BACKCHANNEL_ENV),
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

  /**
   * TEST_SCENARIO: The chart sets no backchannel env when the backchannel is
   * off, and the install then has its public addresses alone.
   */
  it("has no backchannel without its env", () => {
    expect(loadConfig().backchannel).toBeNull();
  });

  it("reads the four backchannel addresses the chart sets", () => {
    Object.assign(process.env, BACKCHANNEL_ENV);
    expect(loadConfig().backchannel).toEqual({
      uiBaseUrl: "http://localhost:4444",
      keycloakExternalUrl: "http://keycloak.localhost:4444",
      shareBaseUrl: "http://share.localhost:4444",
      contentBaseUrl: "http://content.localhost:4444",
    });
  });

  /**
   * TEST_SCENARIO: Part of a backchannel would leave its sign-in or its share
   * pages pointing at the public addresses, so it is refused at boot.
   */
  it("refuses part of a backchannel", () => {
    process.env.BACKCHANNEL_UI_BASE_URL = "http://localhost:4444";
    expect(() => loadConfig()).toThrow(/must be set together/);
  });
});

describe("loadConfig — outbound links", () => {
  const LINKS_ENV = {
    docs: "LINKS_DOCS",
    computeRequest: "LINKS_COMPUTE_REQUEST",
    curveBenderCommunity: "LINKS_CURVE_BENDER_COMMUNITY",
    slackInstallRequest: "LINKS_SLACK_INSTALL_REQUEST",
  } as const;
  const managed = [...Object.keys(REQUIRED_ENV), ...Object.values(LINKS_ENV)];
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

  // TEST_SCENARIO: an install that leaves the chart's links alone keeps the documentation and help addresses the UI had built in before they became configurable.
  it("serves the chart's default links as the UI linked them before", () => {
    const values = load(
      readFileSync(
        new URL("../../../../../helm/values.yaml", import.meta.url),
        "utf8",
      ),
    ) as { links: Record<keyof typeof LINKS_ENV, string> };
    for (const [key, env] of Object.entries(LINKS_ENV)) {
      const value = values.links[key as keyof typeof LINKS_ENV];
      if (value) process.env[env] = value;
    }
    expect(loadConfig().links).toEqual({
      docs: "https://pages.github.ibm.com/dam-agents/docs/",
      computeRequest:
        "https://ibm-research.slack.com/archives/C0B3F03NB24/p1788879773235759",
      curveBenderCommunity:
        "https://ibm.enterprise.slack.com/archives/C0C3E4VJAR1",
      slackInstallRequest: null,
    });
  });

  // TEST_SCENARIO: the chart leaves out the env of a link set empty, and the server then serves no link, which the UI hides.
  it("serves no link for one the install does not set", () => {
    expect(loadConfig().links).toEqual({
      docs: null,
      computeRequest: null,
      curveBenderCommunity: null,
      slackInstallRequest: null,
    });
  });
});
