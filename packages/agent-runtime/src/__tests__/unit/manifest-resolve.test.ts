import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contributionDrivers,
  eventDrivers,
  loadManifest,
  resolveDrivers,
  runtimeManifestSchema,
} from "../../modules/runtime-channel/manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = join(here, "../../../../agents");

const mk = (drivers: Record<string, unknown>) =>
  runtimeManifestSchema.parse({ manifestVersion: 1, drivers });

describe("resolveDrivers", () => {
  it("activates every built-in by default when nothing is declared", () => {
    const r = resolveDrivers(mk({}));
    expect(Object.keys(r).sort()).toEqual([
      "agent-instructions",
      "env",
      "file",
      "initialization",
      "mcp-entry",
      "satellite-outcome",
      "schedule-reset",
      "session-defaults",
      "session-message",
      "skill-ref",
      "startup-items",
      "sub-agent-outcome",
      "trigger",
      "workspace-command",
      "workspace-seed",
    ]);
    expect(r["mcp-entry"]).toMatchObject({
      impl: "mcp-entry",
      path: "$HOME/.mcp.json",
    });
    expect(r["skill-ref"]).toMatchObject({
      impl: "skill-install",
      paths: ["$HOME/.agents/skills"],
    });
  });

  it("defaults impl to the kind name when omitted", () => {
    expect(resolveDrivers(mk({ file: {} })).file?.impl).toBe("file");
  });

  it("disables a built-in with false, leaving the rest", () => {
    const r = resolveDrivers(mk({ "mcp-entry": false }));
    expect("mcp-entry" in r).toBe(false);
    expect("env" in r).toBe(true);
  });

  it("activates a config-bearing kind (harness-config) only when declared", () => {
    expect("harness-config" in resolveDrivers(mk({}))).toBe(false);
    const r = resolveDrivers(
      mk({ "harness-config": { file: "/f", keys: { model: "m" } } }),
    );
    expect(r["harness-config"]).toMatchObject({
      impl: "harness-config",
      file: "/f",
    });
  });

  it("throws on an unknown kind", () => {
    expect(() => resolveDrivers(mk({ bogus: { impl: "x" } }))).toThrow(
      /unknown driver kind/,
    );
  });

  it("splits resolved drivers into contribution vs event subsets", () => {
    const r = resolveDrivers(
      mk({ "harness-config": { file: "/f", keys: { mode: "m" } } }),
    );
    expect(Object.keys(contributionDrivers(r)).sort()).toEqual([
      "env",
      "file",
      "mcp-entry",
      "skill-ref",
    ]);
    expect(Object.keys(eventDrivers(r)).sort()).toEqual([
      "agent-instructions",
      "harness-config",
      "initialization",
      "satellite-outcome",
      "schedule-reset",
      "session-defaults",
      "session-message",
      "startup-items",
      "sub-agent-outcome",
      "trigger",
      "workspace-command",
      "workspace-seed",
    ]);
  });

  it("treats an explicit full driver set (an older manifest) identically", () => {
    const legacy = resolveDrivers(
      mk({
        env: { impl: "env" },
        file: { impl: "file" },
        "mcp-entry": {
          impl: "mcp-entry",
          path: "$HOME/.mcp.json",
          keyPath: "mcpServers",
        },
        "skill-ref": { impl: "skill-install", paths: ["$HOME/.agents/skills"] },
      }),
    );
    expect(legacy).toEqual(resolveDrivers(mk({})));
  });
});

describe("agentProcesses declaration", () => {
  // TEST_SCENARIO: the reaper matches the Name: line of /proc/<pid>/status,
  // TEST_SCENARIO: which the kernel cuts to 15 characters. A longer name could
  // TEST_SCENARIO: never match, and the process it meant would go unprotected.
  it("rejects a name longer than the kernel keeps for a process", () => {
    const result = runtimeManifestSchema.safeParse({
      manifestVersion: 1,
      agentProcesses: ["claude-agent-acp"],
    });
    expect(result.success).toBe(false);
  });
});

describe("shipped agent manifests resolve", () => {
  it("codex writes MCP servers and harness-config into its own config.toml", () => {
    const r = resolveDrivers(
      loadManifest(join(agentsDir, "codex/rootfs/app/runtime-manifest.yaml")),
    );
    expect(r["mcp-entry"]).toEqual({
      impl: "mcp-entry",
      path: "$HOME/.codex/config.toml",
      format: "toml",
      keyPath: "mcp_servers",
      urlKey: "url",
      headersKey: "http_headers",
    });
    expect(r["harness-config"]).toMatchObject({
      impl: "harness-config",
      file: "$HOME/.codex/config.toml",
      format: "toml",
      keys: {
        configOptions: { effort: "model_reasoning_effort" },
      },
      modelDiscovery: {
        urlEnv: ["OPENAI_BASE_URL"],
        pinEnv: ["OPENAI_MODEL"],
      },
    });
    expect(r["harness-config"]).not.toHaveProperty(
      "modelDiscovery.redirectEnv",
    );
    expect("env" in r && "skill-ref" in r && "trigger" in r).toBe(true);
  });

  it("every shipped manifest loads with its expected harness-config", () => {
    const expected: Record<string, string | undefined> = {
      base: undefined,
      bob: "$HOME/.bob/settings/settings.json",
      "claude-code": "$HOME/.claude/settings.json",
      "k-search": undefined,
      "pi-agent": "$HOME/.pi/agent/settings.json",
    };
    for (const [agent, file] of Object.entries(expected)) {
      const manifest = loadManifest(
        join(agentsDir, agent, "rootfs/app/runtime-manifest.yaml"),
      );
      const r = resolveDrivers(manifest);
      expect(r["harness-config"]?.file, agent).toBe(file);
      expect("env" in r && "trigger" in r, agent).toBe(true);
    }
  });

  /**
   * TEST_SCENARIO: Each shipped harness names the variable it sets on its
   * shell commands, so git's trace can name the Session behind a commit; a
   * harness that sets none, Bob, declares none.
   */
  it("every shipped manifest names its Session variable", () => {
    const expected: Record<string, string | undefined> = {
      bob: undefined,
      "claude-code": "CLAUDE_CODE_SESSION_ID",
      codex: "CODEX_THREAD_ID",
      "pi-agent": "PI_SESSION_ID",
    };
    for (const [agent, name] of Object.entries(expected)) {
      const manifest = loadManifest(
        join(agentsDir, agent, "rootfs/app/runtime-manifest.yaml"),
      );
      expect(manifest.sessionEnvVar, agent).toBe(name);
    }
  });

  /**
   * TEST_SCENARIO: A Session variable that is not an environment variable's
   * name is refused when the manifest loads.
   */
  it("refuses a Session variable that is not a variable name", () => {
    expect(() =>
      runtimeManifestSchema.parse({
        manifestVersion: 1,
        sessionEnvVar: "not a name",
      }),
    ).toThrow();
  });
});
