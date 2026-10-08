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
import type {
  ModelDiscovery,
  ModelDiscoveryOutcome,
} from "../../modules/runtime-channel/infrastructure/model-discovery.js";
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
 * model the upstream provider does not serve: its built-in default, or a model
 * chosen on the provider the agent was switched away from. What it must not do
 * is speak for a harness that is talking to its own provider, or overwrite a
 * value somebody chose that the provider lists. A listing that is not there yet
 * is asked again rather than taken as empty.
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

  const listing = (via: string): ModelDiscoveryOutcome => ({
    status: "observed",
    via,
    models: [
      { value: "first/model", name: "first/model" },
      { value: "second/model", name: "second/model" },
    ],
  });

  const seedWith = (
    env: Record<string, string>,
    via: string,
    discoverModels: ModelDiscovery = async () => listing(via),
  ) => {
    const envReader: RuntimeEnvReader = {
      current: () => env,
      ready: () => true,
    };
    return createHarnessConfigPlugin({
      binding: BINDING,
      agentHome: home,
      envReader,
      discoverModels,
      seedListingRetry: { attempts: 3, delayMs: 0 },
      log: () => {},
    }).seedModel();
  };

  const writeModel = (model: string) => {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ platform: { model } }));
  };

  const readModel = (): unknown => {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      platform?: { model?: unknown };
    };
    return parsed.platform?.model;
  };

  /**
   * TEST_SCENARIO: Only the source that answers speaks for the seed. A pin or
   * a redirect variable belonging to a source that was not asked must neither
   * block the seed nor justify one.
   */
  it("judges pins and redirects by the source that answered", async () => {
    const binding: HarnessConfigBinding = {
      ...BINDING,
      modelDiscovery: [
        {
          urlEnv: ["OPENAI_URL"],
          redirectEnv: ["OPENAI_URL"],
          pinEnv: ["OPENAI_MODEL"],
        },
        {
          urlEnv: ["BEDROCK_URL"],
          redirectEnv: ["BEDROCK_URL"],
          pinEnv: ["BEDROCK_MODEL"],
        },
      ],
    };
    const env = {
      BEDROCK_URL: "https://bedrock",
      OPENAI_MODEL: "gpt-unrelated",
    };
    const plugin = createHarnessConfigPlugin({
      binding,
      agentHome: home,
      envReader: { current: () => env, ready: () => true },
      seedListingRetry: { attempts: 1, delayMs: 0 },
      discoverModels: async () => ({
        status: "observed",
        via: "BEDROCK_URL",
        models: [{ value: "eu.profile", name: "eu.profile" }],
      }),
      log: () => {},
    });
    expect(await plugin.seedModel()).toBe(true);
    expect(readModel()).toBe("eu.profile");
  });

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

  it("yields to a model pinned on the provider when the provider lists it", async () => {
    expect(
      await seedWith(
        { REDIRECT_URL: "https://proxy", PINNED_MODEL: "second/model" },
        "REDIRECT_URL",
      ),
    ).toBe(false);
    expect(() => readFileSync(settingsPath, "utf8")).toThrow();
  });

  /**
   * TEST_SCENARIO: A connection's pin is written once and the provider's
   * catalogue moves on, so a pinned model can stop existing upstream. The pin
   * is a default, not a promise: when the listing does not know it, the
   * first listed model is seeded instead of letting every turn fail on it.
   */
  it("passes over a pinned model the provider does not list", async () => {
    expect(
      await seedWith(
        { REDIRECT_URL: "https://proxy", PINNED_MODEL: "retired/model" },
        "REDIRECT_URL",
      ),
    ).toBe(true);
    expect(readModel()).toBe("first/model");
  });

  it("keeps a set model the provider lists", async () => {
    writeModel("second/model");
    expect(
      await seedWith({ REDIRECT_URL: "https://proxy" }, "REDIRECT_URL"),
    ).toBe(false);
    expect(readModel()).toBe("second/model");
  });

  /**
   * TEST_SCENARIO: The agent was switched to another provider with a model
   * chosen on the previous one still in the file. The new provider refuses
   * every turn on a model it does not list, so keeping the choice keeps the
   * agent broken; the first listed model takes its place.
   */
  it("replaces a set model the provider does not list", async () => {
    writeModel("chosen/on-old-provider");
    expect(
      await seedWith({ REDIRECT_URL: "https://proxy" }, "REDIRECT_URL"),
    ).toBe(true);
    expect(readModel()).toBe("first/model");
  });

  /**
   * TEST_SCENARIO: The provider the agent was switched to pins a model, as the
   * LiteLLM presets do, while the file still names one chosen on the old
   * provider. The file outranks the pin, so the stale choice has to go for the
   * pin to apply; nothing is seeded in its place.
   */
  it("clears a set model the provider does not list when a listed pin stands behind it", async () => {
    writeModel("chosen/on-old-provider");
    expect(
      await seedWith(
        { REDIRECT_URL: "https://proxy", PINNED_MODEL: "second/model" },
        "REDIRECT_URL",
      ),
    ).toBe(true);
    expect(readModel()).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A provider switch lands as an env change while the gateway
   * fronting the new provider is still rolling, so the first listing fails
   * with no answer at all. Giving up there leaves the agent on a model the
   * provider will refuse; the seed asks again until the gateway answers.
   */
  it("asks again while the listing is unavailable", async () => {
    let asked = 0;
    const lateListing: ModelDiscovery = async () => {
      asked += 1;
      return asked < 3 ? { status: "unavailable" } : listing("REDIRECT_URL");
    };
    expect(
      await seedWith(
        { REDIRECT_URL: "https://proxy" },
        "REDIRECT_URL",
        lateListing,
      ),
    ).toBe(true);
    expect(asked).toBe(3);
    expect(readModel()).toBe("first/model");
  });
});
