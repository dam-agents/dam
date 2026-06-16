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
import type {
  Contribution,
  DispatchContext,
  DriverBinding,
} from "agent-runtime-api";
import { createHarnessConfigPlugin } from "../../modules/runtime-channel/drivers/harness-config-plugin.js";

const BINDING: DriverBinding = {
  impl: "harness-config",
  file: "$HOME/.claude/settings.json",
  keys: {
    model: "model",
    mode: "permissions.defaultMode",
    configOptions: { thought_level: "effortLevel" },
  },
};

describe("harness-config driver", () => {
  let home: string;
  let stateDir: string;
  let settingsPath: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "harness-config-"));
    stateDir = join(home, ".platform", "plugins", "harness-config");
    mkdirSync(stateDir, { recursive: true });
    settingsPath = join(home, ".claude", "settings.json");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const handler = () =>
    createHarnessConfigPlugin().bind("harness-config", BINDING);

  const ctx: () => DispatchContext = () => ({
    agentHome: home,
    pluginStateDir: stateDir,
    log: () => {},
  });

  const apply = (contributions: Contribution[]) =>
    handler()(contributions, ctx());

  const readSettings = () =>
    JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;

  it("maps model, mode, and config options to their (nested) keys", async () => {
    await apply([
      {
        kind: "harness-config",
        model: "opus",
        mode: "plan",
        configOptions: { thought_level: "high" },
      },
    ]);
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
    await apply([{ kind: "harness-config", model: "sonnet", mode: "acceptEdits" }]);
    expect(readSettings()).toEqual({
      theme: "dark",
      model: "sonnet",
      permissions: { allow: ["Bash"], defaultMode: "acceptEdits" },
    });
  });

  it("removes a managed key when its field is cleared, leaving user keys", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
    await apply([{ kind: "harness-config", model: "opus", mode: "plan" }]);
    // Second apply drops `mode`; `model` stays, `permissions.defaultMode` is removed.
    await apply([{ kind: "harness-config", model: "opus" }]);
    expect(readSettings()).toEqual({ theme: "dark", model: "opus" });
  });

  it("skips a config option that has no key mapping in the binding", async () => {
    await apply([
      { kind: "harness-config", configOptions: { unmapped: "x" } },
    ]);
    // Nothing mapped and no prior state → no file written at all.
    expect(existsSync(settingsPath)).toBe(false);
  });

  it("does not create a file when there is nothing to write", async () => {
    await apply([]);
    expect(existsSync(settingsPath)).toBe(false);
    await apply([{ kind: "harness-config" }]);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it("throws rather than clobbering an unparseable settings file", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath, "{ not json");
    await expect(
      apply([{ kind: "harness-config", model: "opus" }]),
    ).rejects.toThrow();
    expect(readFileSync(settingsPath, "utf8")).toBe("{ not json");
  });
});
