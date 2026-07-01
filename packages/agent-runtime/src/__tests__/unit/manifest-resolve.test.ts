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
const baseManifest = join(
  here,
  "../../../../platform-base/runtime-manifest.yaml",
);

// Build a RuntimeManifest from a plain drivers map (the schema fills defaults).
const mk = (drivers: Record<string, unknown>) =>
  runtimeManifestSchema.parse({ manifestVersion: 1, drivers });

describe("resolveDrivers", () => {
  it("activates every built-in by default when nothing is declared", () => {
    const r = resolveDrivers(mk({}));
    expect(Object.keys(r).sort()).toEqual([
      "env",
      "experiment-trigger",
      "file",
      "mcp-entry",
      "schedule-reset",
      "skill-ref",
      "trigger",
      "workspace-seed",
    ]);
    expect(r["mcp-entry"]).toMatchObject({
      impl: "mcp-entry",
      path: "$HOME/.mcp.json",
    });
    // The one built-in whose impl name differs from its kind, preserved as a
    // default so older manifests naming it explicitly still resolve. The default
    // paths are load-bearing — server.ts reads them for the skills service.
    expect(r["skill-ref"]).toMatchObject({
      impl: "skill-install",
      paths: ["$HOME/.agents/skills"],
    });
  });

  it("defaults impl to the kind name when omitted", () => {
    expect(resolveDrivers(mk({ file: {} })).file?.impl).toBe("file");
  });

  it("honors an explicit impl (older manifests + overrides)", () => {
    const r = resolveDrivers(
      mk({ "skill-ref": { impl: "skill-install", paths: ["/x"] } }),
    );
    expect(r["skill-ref"]).toMatchObject({
      impl: "skill-install",
      paths: ["/x"],
    });
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
      "experiment-trigger",
      "harness-config",
      "schedule-reset",
      "trigger",
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

describe("shipped agent manifests resolve", () => {
  it("claude-code declares harness-config and inherits the built-ins", () => {
    const r = resolveDrivers(
      loadManifest(join(agentsDir, "claude-code/runtime-manifest.yaml")),
    );
    expect(r["harness-config"]).toMatchObject({
      impl: "harness-config",
      file: "$HOME/.claude/settings.json",
    });
    expect("env" in r && "file" in r && "trigger" in r).toBe(true);
  });

  it("pi-agent declares harness-config with modelDiscovery", () => {
    const r = resolveDrivers(
      loadManifest(join(agentsDir, "pi-agent/runtime-manifest.yaml")),
    );
    expect(r["harness-config"]).toMatchObject({
      impl: "harness-config",
      file: "$HOME/.pi/agent/settings.json",
    });
  });

  it("platform-base is all defaults (no harness-config)", () => {
    const r = resolveDrivers(loadManifest(baseManifest));
    expect("harness-config" in r).toBe(false);
    expect("env" in r && "trigger" in r).toBe(true);
  });
});
