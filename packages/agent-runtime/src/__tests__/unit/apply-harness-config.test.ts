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
      harness: "test",
      binding,
      agentHome: home,
      envReader: asLease(noEnv),
      discoverModels: noDiscovery,
      log: () => {},
    }).apply(payload);
  const apply = (payload: HarnessConfigEventPayload) =>
    applyWith(BINDING, payload);

  /** TEST_SCENARIO: The capability the runtime publishes names the settings
   * whose start mode it derives, and names none for a harness that does not
   * opt in, so the picker derives a mode only where the runtime does. */
  it("publishes the settings whose start mode the runtime derives", () => {
    const capability = (
      sessionSettings: HarnessConfigBinding["sessionSettings"],
    ) =>
      createHarnessConfigPlugin({
        harness: "test",
        binding: { ...BINDING, sessionSettings },
        agentHome: home,
        envReader: asLease(noEnv),
        discoverModels: noDiscovery,
        log: () => {},
      });
    expect(
      capability({
        mode: { mode: true, deriveStartMode: true },
        effort: { configOption: "effortLevel" },
      }).derivedStartMode,
    ).toEqual(["mode"]);
    expect(capability({ mode: { mode: true } }).derivedStartMode).toBe(
      undefined,
    );
  });

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
    const obj = readSettings();
    obj.model = "sonnet";
    writeFileSync(settingsPath, JSON.stringify(obj));
    await apply({ mode: "plan" });
    expect(readSettings()).toEqual({
      model: "sonnet",
      permissions: { defaultMode: "plan" },
    });
  });

  it("writes an option mapped to several keys into each, and unsets them together", async () => {
    const binding: HarnessConfigBinding = {
      ...BINDING,
      keys: {
        configOptions: {
          cacheTtl: ["promptCacheTtl", "subagentPromptCacheTtl"],
        },
      },
    };
    await applyWith(binding, { configOptions: { cacheTtl: "1h" } });
    expect(readSettings()).toEqual({
      promptCacheTtl: "1h",
      subagentPromptCacheTtl: "1h",
    });
    await applyWith(binding, { unset: ["cacheTtl"] });
    expect(readSettings()).toEqual({});
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
      harness: "test",
      binding: TOML_BINDING,
      agentHome: home,
      envReader: asLease(noEnv),
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

describe("the per-model auto-compact windows", () => {
  let home: string;
  let settingsPath: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "harness-config-windows-"));
    settingsPath = join(home, ".claude", "settings.json");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const pluginWith = (binding: HarnessConfigBinding | undefined) =>
    createHarnessConfigPlugin({
      harness: "test",
      binding,
      agentHome: home,
      envReader: asLease(noEnv),
      discoverModels: noDiscovery,
      log: () => {},
    });
  const WINDOWS: HarnessConfigBinding = {
    ...BINDING,
    modelAutoCompactWindow: {
      keyPath: "modelSettings",
      field: "autoCompactWindow",
      unknownWindow: 200_000,
    },
  };

  /** TEST_SCENARIO: Each model the harness may run on gets its window under the name the router resolves it by, and one whose Connection declares no window gets the explicit 200k rather than inheriting the widest one, which would compact it too late. */
  it("writes one window per model, keyed by the router's name", async () => {
    await pluginWith(WINDOWS).writeModelWindows([
      {
        name: "claude/cb/rits/deepseek-ai/deepseek-v4.1-flash-1017",
        contextWindow: 1_048_576,
      },
      { name: "claude/ibm/aws/claude-opus-5-5", contextWindow: 200_000 },
      { name: "claude/ibm/gpt-5.5", contextWindow: null },
    ]);
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      modelSettings: {
        "claude/cb/rits/deepseek-ai/deepseek-v4.1-flash-1017": {
          autoCompactWindow: 1_048_576,
        },
        "claude/ibm/aws/claude-opus-5-5": { autoCompactWindow: 200_000 },
        "claude/ibm/gpt-5.5": { autoCompactWindow: 200_000 },
      },
    });
  });

  /** TEST_SCENARIO: The map leaves the rest of the file alone, so the person's model, mode and effort survive a re-listing, and the process-wide CLAUDE_CODE_AUTO_COMPACT_WINDOW is never written, since it would override every per-model value. */
  it("keeps the file's other values and never sets the process-wide window", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ model: "opus", effortLevel: "high" }),
    );
    await pluginWith(WINDOWS).writeModelWindows([
      { name: "claude/cb/x", contextWindow: 1_000_000 },
    ]);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(parsed.model).toBe("opus");
    expect(parsed.effortLevel).toBe("high");
    expect(parsed.modelSettings).toEqual({
      "claude/cb/x": { autoCompactWindow: 1_000_000 },
    });
    expect(JSON.stringify(parsed)).not.toContain("AUTO_COMPACT_WINDOW");
  });

  /** TEST_SCENARIO: A harness whose manifest does not ask for the map gets no file written at all, and a binding that does ask for it writes nothing when the agent has no listed model to map. */
  it("writes nothing unless asked, and nothing for an empty listing", async () => {
    await pluginWith(BINDING).writeModelWindows([
      { name: "claude/cb/x", contextWindow: 1_000_000 },
    ]);
    expect(existsSync(settingsPath)).toBe(false);
    await pluginWith(WINDOWS).writeModelWindows([]);
    expect(existsSync(settingsPath)).toBe(false);
  });
});
