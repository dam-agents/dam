import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HarnessConfigEventPayload } from "agent-runtime-api";
import type { RuntimeEnvReader } from "../../core/runtime-env.js";
import { createHarnessConfigPlugin } from "../../modules/runtime-channel/drivers/harness-config-plugin.js";
import type { ModelDiscovery } from "../../modules/runtime-channel/infrastructure/model-discovery.js";
import type { HarnessConfigBinding } from "../../modules/runtime-channel/manifest.js";

// apply needs neither env nor discovery; stub them to construct the driver.
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

describe("harness-config event handler", () => {
  let home: string;
  let settingsPath: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "harness-config-"));
    settingsPath = join(home, ".claude", "settings.json");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const applyWith = (
    binding: HarnessConfigBinding | undefined,
    payload: HarnessConfigEventPayload,
  ) =>
    createHarnessConfigPlugin({
      binding,
      agentHome: home,
      envReader: noEnv,
      discoverModels: noDiscovery,
      log: () => {},
    }).apply(payload);
  const apply = (payload: HarnessConfigEventPayload) =>
    applyWith(BINDING, payload);

  const readSettings = () =>
    JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;

  it("applies model, mode, and config options to their mapped (nested) keys", async () => {
    await apply({
      model: "opus",
      mode: "plan",
      configOptions: { effort: "high" },
    });
    expect(readSettings()).toEqual({
      model: "opus",
      permissions: { defaultMode: "plan" },
      effortLevel: "high",
    });
  });

  it("preserves user-authored keys, including siblings of a nested target", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ theme: "dark", permissions: { allow: ["Bash"] } }),
    );
    await apply({ model: "sonnet", mode: "acceptEdits" });
    expect(readSettings()).toEqual({
      theme: "dark",
      model: "sonnet",
      permissions: { allow: ["Bash"], defaultMode: "acceptEdits" },
    });
  });

  it("unset removes a key and prunes the emptied parent, leaving user keys", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
    await apply({ model: "opus", mode: "plan" });
    await apply({ unset: ["mode"] });
    expect(readSettings()).toEqual({ theme: "dark", model: "opus" });
  });

  it("never re-asserts: a user file edit after an apply is left untouched", async () => {
    await apply({ model: "opus" });
    // User edits the file directly.
    const obj = readSettings();
    obj.model = "sonnet";
    writeFileSync(settingsPath, JSON.stringify(obj));
    // A later unrelated apply (set mode) does not touch the user's model edit.
    await apply({ mode: "plan" });
    expect(readSettings()).toEqual({
      model: "sonnet",
      permissions: { defaultMode: "plan" },
    });
  });

  it("skips a config option with no key mapping", async () => {
    await apply({ configOptions: { unmapped: "x" } });
    expect(existsSync(settingsPath)).toBe(false);
  });

  it("is a no-op when the harness has no harnessConfig binding", async () => {
    await applyWith(undefined, { model: "opus" });
    expect(existsSync(settingsPath)).toBe(false);
  });

  it("throws rather than clobbering an unparseable settings file", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{ not json");
    await expect(apply({ model: "opus" })).rejects.toThrow();
    expect(readFileSync(settingsPath, "utf8")).toBe("{ not json");
  });
});

describe("harness-config event handler (TOML)", () => {
  let home: string;
  let configPath: string;

  const TOML_BINDING: HarnessConfigBinding = {
    file: "$HOME/.codex/config.toml",
    format: "toml",
    keys: {
      mode: "approval_policy",
      configOptions: { effort: "model_reasoning_effort" },
    },
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "harness-config-toml-"));
    configPath = join(home, ".codex", "config.toml");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const apply = (payload: HarnessConfigEventPayload) =>
    createHarnessConfigPlugin({
      binding: TOML_BINDING,
      agentHome: home,
      envReader: noEnv,
      discoverModels: noDiscovery,
      log: () => {},
    }).apply(payload);

  it("writes mapped keys as TOML, preserving existing keys", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(configPath, 'sandbox_mode = "danger-full-access"\n');
    await apply({ mode: "never", configOptions: { effort: "high" } });
    const parsed = (await import("smol-toml")).parse(
      readFileSync(configPath, "utf8"),
    );
    expect(parsed).toEqual({
      sandbox_mode: "danger-full-access",
      approval_policy: "never",
      model_reasoning_effort: "high",
    });
  });

  it("unset removes a TOML key", async () => {
    await apply({ configOptions: { effort: "high" } });
    await apply({ unset: ["effort"] });
    const parsed = (await import("smol-toml")).parse(
      readFileSync(configPath, "utf8"),
    );
    expect(parsed).toEqual({});
  });
});
