import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";
import { BOB_HOST } from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const bobManifestPath = join(
  here,
  "../../../../agents/bob/runtime-manifest.yaml",
);

function bobEnvContributions(): Record<string, string> {
  const template = buildCatalog().find((t) => t.id === "bob");
  if (!template) throw new Error("bob template missing from catalog");
  return Object.fromEntries(
    template.contributions
      .filter((c) => c.kind === "env")
      .map((c) => [c.name, c.placeholder]),
  );
}

function bobDiscoveryEnvNames(): string[] {
  const manifest = parseYaml(readFileSync(bobManifestPath, "utf8")) as {
    drivers: {
      "harness-config": { modelDiscovery: { urlEnv: string[] } };
    };
  };
  return manifest.drivers["harness-config"].modelDiscovery.urlEnv;
}

describe("bob connection template", () => {
  // TEST_SCENARIO: model discovery reads the gateway URL out of the pod env, so the variable Bob's manifest falls back to has to be one the Bob Shell connection actually contributes — otherwise the panel's model list silently stays empty.
  it("contributes the gateway its own model discovery falls back to", () => {
    expect(bobEnvContributions()["BOB_DEFAULT_GATEWAY_URL"]).toBe(
      `https://${BOB_HOST}`,
    );
    expect(bobDiscoveryEnvNames()).toContain("BOB_DEFAULT_GATEWAY_URL");
  });

  // TEST_SCENARIO: an agent can hold both this connection and one that points Bob at another endpoint, and the env rail settles a duplicate name by secret order — so the two must contribute different names, and the one that redirects Bob has to be read first.
  it("leaves BOB_GATEWAY_URL to the connection that redirects Bob", () => {
    expect(bobEnvContributions()).not.toHaveProperty("BOB_GATEWAY_URL");
    const names = bobDiscoveryEnvNames();
    expect(names.indexOf("BOB_GATEWAY_URL")).toBeLessThan(
      names.indexOf("BOB_DEFAULT_GATEWAY_URL"),
    );
  });
});
