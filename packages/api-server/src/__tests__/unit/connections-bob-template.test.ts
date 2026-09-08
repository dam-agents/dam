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
  // TEST_SCENARIO: model discovery reads the gateway URL out of the pod env, so every env var Bob's manifest names has to be one the Bob Shell connection actually contributes — otherwise the panel's model list silently stays empty.
  it("contributes every env var Bob's model discovery reads", () => {
    const env = bobEnvContributions();
    for (const name of bobDiscoveryEnvNames()) {
      expect(env[name]).toBe(`https://${BOB_HOST}`);
    }
  });
});
