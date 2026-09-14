import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeEnvReader } from "../../core/runtime-env.js";
import { createHarnessConfigPlugin } from "../../modules/runtime-channel/drivers/harness-config-plugin.js";
import type { ModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";
import type { HarnessConfigBinding } from "../../modules/runtime-channel/manifest.js";

const BINDING: HarnessConfigBinding = {
  file: "$HOME/.bob/settings/settings.json",
  format: "json",
  keys: { model: "platform.model" },
  modelDiscovery: {
    urlEnv: ["REDIRECT_URL", "OWN_GATEWAY_URL"],
    redirectEnv: ["REDIRECT_URL"],
    pinEnv: ["PINNED_MODEL"],
  },
};

/**
 * TEST_OVERVIEW: The seed exists so a redirected harness never starts on a
 * built-in default the upstream provider does not serve. What it must not do
 * is speak for a harness that is talking to its own provider, or overwrite a
 * value somebody already chose.
 */
describe("seeding a discovered model", () => {
  let home: string;
  let settingsPath: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "seed-model-"));
    settingsPath = join(home, ".bob", "settings", "settings.json");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const seedWith = (env: Record<string, string>, via: string) => {
    const envReader: RuntimeEnvReader = {
      current: () => env,
      ready: () => true,
    };
    const discoverModels: ModelDiscovery = async () => ({
      status: "observed",
      via,
      models: [
        { value: "first/model", name: "first/model" },
        { value: "second/model", name: "second/model" },
      ],
    });
    return createHarnessConfigPlugin({
      binding: BINDING,
      agentHome: home,
      envReader,
      discoverModels,
      log: () => {},
    }).seedModel();
  };

  const readModel = (): unknown => {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      platform?: { model?: unknown };
    };
    return parsed.platform?.model;
  };

  it("writes the first discovered model when a connection redirects the harness", async () => {
    expect(
      await seedWith({ REDIRECT_URL: "https://proxy" }, "REDIRECT_URL"),
    ).toBe(true);
    expect(readModel()).toBe("first/model");
  });

  it("leaves the harness's own provider alone", async () => {
    expect(
      await seedWith({ OWN_GATEWAY_URL: "https://own" }, "OWN_GATEWAY_URL"),
    ).toBe(false);
    expect(() => readFileSync(settingsPath, "utf8")).toThrow();
  });

  it("yields to a model pinned on the provider", async () => {
    expect(
      await seedWith(
        { REDIRECT_URL: "https://proxy", PINNED_MODEL: "operator/choice" },
        "REDIRECT_URL",
      ),
    ).toBe(false);
    expect(() => readFileSync(settingsPath, "utf8")).toThrow();
  });

  it("never overwrites a model that is already set", async () => {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ platform: { model: "chosen/model" } }),
    );
    expect(
      await seedWith({ REDIRECT_URL: "https://proxy" }, "REDIRECT_URL"),
    ).toBe(false);
    expect(readModel()).toBe("chosen/model");
  });
});
