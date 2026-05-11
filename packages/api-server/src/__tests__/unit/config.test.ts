import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../config.js";

function withMinimumEnv(extra: Record<string, string | undefined> = {}) {
  process.env.PLATFORM_RELEASE_NAME = "platform";
  process.env.DATABASE_URL = "postgres://localhost/platform";
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("loadConfig: keycloakCliClientId", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it("defaults to 'platform-cli' when KEYCLOAK_CLI_CLIENT_ID is unset", () => {
    withMinimumEnv({ KEYCLOAK_CLI_CLIENT_ID: undefined });
    const config = loadConfig();
    expect(config.keycloakCliClientId).toBe("platform-cli");
  });

  it("reflects KEYCLOAK_CLI_CLIENT_ID when set", () => {
    withMinimumEnv({ KEYCLOAK_CLI_CLIENT_ID: "custom-cli-client" });
    const config = loadConfig();
    expect(config.keycloakCliClientId).toBe("custom-cli-client");
  });
});
