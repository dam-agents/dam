import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  LeaseEnvReader,
  RuntimeEnvReader,
} from "../../core/runtime-env.js";
import { createHarnessConfigPlugin } from "../../modules/runtime-channel/drivers/harness-config-plugin.js";
import type { ModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";
import type { HarnessConfigBinding } from "../../modules/runtime-channel/manifest.js";

function asLease(reader: RuntimeEnvReader): LeaseEnvReader {
  return { ...reader, providers: () => [], forLease: () => reader.current() };
}

const noop = () => {};
const noEnv: RuntimeEnvReader = { current: () => ({}), ready: () => true };
const noDiscovery: ModelDiscovery = async () => ({
  status: "not-configured",
});

const BINDING: HarnessConfigBinding = {
  file: "$HOME/.claude/settings.json",
  format: "json",
  keys: {
    model: "model",
    mode: "permissions.defaultMode",
    configOptions: { effort: "effortLevel" },
  },
};

describe("createReadHarnessConfig", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hcr-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const writeSettings = (obj: unknown) =>
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify(obj));

  const read = (discoverModels: ModelDiscovery, binding = BINDING) =>
    createHarnessConfigPlugin({
      harness: "test",
      binding,
      agentHome: home,
      envReader: asLease(noEnv),
      discoverModels,
      log: noop,
    }).readCurrent;

  it("maps the config file back to logical fields and merges discovered models", async () => {
    writeSettings({
      model: "opus",
      permissions: { defaultMode: "auto" },
      effortLevel: "high",
    });
    const out = await read(async () => ({
      status: "observed",
      models: [{ value: "opus", name: "opus" }],
      via: "TEST_URL",
    }))();
    expect(out).toEqual({
      model: "opus",
      mode: "auto",
      configOptions: { effort: "high" },
      defaultModel: null,
      availableModels: [{ value: "opus", name: "opus" }],
    });
  });

  it("returns empty current values for a missing file but still discovers", async () => {
    const out = await read(async () => ({
      status: "observed",
      models: [{ value: "x", name: "x" }],
      via: "TEST_URL",
    }))();
    expect(out).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      defaultModel: null,
      availableModels: [{ value: "x", name: "x" }],
    });
  });

  it("tolerates an unparseable file (empty current values)", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), "{ not json");
    expect(await read(noDiscovery)()).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      defaultModel: null,
      availableModels: null,
    });
  });

  // TEST_SCENARIO: Claude Code's catalog is its model tiers; a provider's listing adds to them rather than replacing them, so both stay pickable.
  it("lists the catalog's models ahead of discovered ones when the source extends the catalog", async () => {
    const out = await createHarnessConfigPlugin({
      harness: "test",
      binding: {
        ...BINDING,
        catalog: {
          options: [
            {
              id: "model",
              name: "Model",
              category: "model",
              choices: [{ value: "opus", name: "Opus" }],
            },
          ],
        },
        modelDiscovery: { urlEnv: ["U"], extendsCatalog: true },
      },
      agentHome: home,
      envReader: asLease({
        current: () => ({ U: "https://proxy" }),
        ready: () => true,
      }),
      discoverModels: async () => ({
        status: "observed",
        models: [
          { value: "opus", name: "opus" },
          { value: "claude/glm", name: "claude/glm" },
        ],
        via: "U",
      }),
      log: noop,
    }).readCurrent();
    expect(out.availableModels).toEqual([
      { value: "opus", name: "Opus" },
      { value: "claude/glm", name: "claude/glm" },
    ]);
  });

  // TEST_SCENARIO: before the env rail has materialized once, a missing URL says nothing about the grant, so the read must not clear an established list.
  it("omits the model list until the runtime env has materialized", async () => {
    const out = await createHarnessConfigPlugin({
      harness: "test",
      binding: { ...BINDING, modelDiscovery: { urlEnv: ["U"] } },
      agentHome: home,
      envReader: asLease({ current: () => ({}), ready: () => false }),
      discoverModels: noDiscovery,
      log: noop,
    }).readCurrent();
    expect(out).not.toHaveProperty("availableModels");
  });

  it("returns all-null when the harness declares no binding", async () => {
    const out = await createHarnessConfigPlugin({
      harness: "test",
      binding: undefined,
      agentHome: home,
      envReader: asLease(noEnv),
      discoverModels: noDiscovery,
      log: noop,
    }).readCurrent();
    expect(out).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      defaultModel: null,
      availableModels: null,
    });
  });
});
