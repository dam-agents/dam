import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeEnvReader } from "../../core/runtime-env.js";
import { createHarnessConfigPlugin } from "../../modules/runtime-channel/drivers/harness-config-plugin.js";
import type { ModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";
import type { HarnessConfigBinding } from "../../modules/runtime-channel/manifest.js";

const noop = () => {};
const noEnv: RuntimeEnvReader = { current: () => ({}), ready: () => true };
const noDiscovery: ModelDiscovery = async () => null;

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
      binding,
      agentHome: home,
      envReader: noEnv,
      discoverModels,
      log: noop,
    }).readCurrent;

  it("maps the config file back to logical fields and merges discovered models", async () => {
    writeSettings({
      model: "opus",
      permissions: { defaultMode: "auto" },
      effortLevel: "high",
    });
    const out = await read(async () => [{ value: "opus", name: "opus" }])();
    expect(out).toEqual({
      model: "opus",
      mode: "auto",
      configOptions: { effort: "high" },
      availableModels: [{ value: "opus", name: "opus" }],
    });
  });

  it("returns empty current values for a missing file but still discovers", async () => {
    const out = await read(async () => [{ value: "x", name: "x" }])();
    expect(out).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      availableModels: [{ value: "x", name: "x" }],
    });
  });

  it("tolerates an unparseable file (empty current values)", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), "{ not json");
    expect(await read(noDiscovery)()).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      availableModels: null,
    });
  });

  it("returns all-null when the harness declares no binding", async () => {
    const out = await createHarnessConfigPlugin({
      binding: undefined,
      agentHome: home,
      envReader: noEnv,
      discoverModels: noDiscovery,
      log: noop,
    }).readCurrent();
    expect(out).toEqual({
      model: null,
      mode: null,
      configOptions: {},
      availableModels: null,
    });
  });
});
