import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { Contribution, Plugin } from "agent-runtime-api";
import { createDispatcher } from "../../modules/runtime-channel/dispatcher.js";
import { createPluginRegistry } from "../../modules/runtime-channel/infrastructure/plugin-registry.js";
import type { RuntimeManifest } from "../../modules/runtime-channel/manifest.js";

const fixtureDirs: string[] = [];
function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "dispatcher-"));
  fixtureDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (fixtureDirs.length) {
    const d = fixtureDirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function manifest(drivers: RuntimeManifest["drivers"]): RuntimeManifest {
  return { manifestVersion: 1, drivers };
}

function plugin(name: string, handler: Plugin["bind"]): Plugin {
  return { name, bind: handler };
}

const env = () => ({
  agentHome: mkTmp(),
  pluginStateRoot: mkTmp(),
  log: vi.fn(),
});

describe("Dispatcher", () => {
  it("routes contributions through the plugin bound to each kind", async () => {
    const calls: { kind: string; contribs: Contribution[] }[] = [];
    const registry = createPluginRegistry();
    registry.register(
      plugin("file", (kind) => async (contribs) => {
        calls.push({ kind, contribs });
      }),
    );

    const dispatcher = createDispatcher({
      manifest: manifest({ file: { impl: "file" } }),
      registry,
      env: env(),
    });
    await dispatcher.apply([
      {
        kind: "file",
        path: "$HOME/test",
        format: "json",
        mergeMode: "overwrite",
        content: {},
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("file");
    expect(calls[0]!.contribs).toHaveLength(1);
  });

  it("invokes every bound kind on apply, even with an empty desired set (removal signal)", async () => {
    const calls = vi.fn(async () => {});
    const registry = createPluginRegistry();
    registry.register(plugin("file", () => calls));

    const dispatcher = createDispatcher({
      manifest: manifest({ file: { impl: "file" } }),
      registry,
      env: env(),
    });
    await dispatcher.apply([]);

    expect(calls).toHaveBeenCalledOnce();
    // First call's first arg = the contributions list.
    const firstCall = calls.mock.calls[0] as unknown as [
      readonly Contribution[],
      unknown,
    ];
    expect(firstCall[0]).toEqual([]);
  });

  it("fails at compose time when a manifest binding references an unknown impl", () => {
    expect(() =>
      createDispatcher({
        manifest: manifest({ file: { impl: "nope" } }),
        registry: createPluginRegistry(),
        env: env(),
      }),
    ).toThrow(/no plugin with that name is registered/);
  });

  it("isolates per-kind handler failures — one bad kind doesn't block others", async () => {
    const goodCalls = vi.fn(async () => {});
    const logged: string[] = [];
    const registry = createPluginRegistry();
    registry.register(plugin("good", () => goodCalls));
    registry.register(
      plugin("bad", () => async () => {
        throw new Error("bang");
      }),
    );

    const dispatcher = createDispatcher({
      manifest: manifest({
        file: { impl: "good" },
        "mcp-entry": { impl: "bad" },
      }),
      registry,
      env: { ...env(), log: (m: string) => logged.push(m) },
    });
    await dispatcher.apply([]);

    expect(goodCalls).toHaveBeenCalledOnce();
    expect(logged.some((m) => m.includes("driver mcp-entry failed"))).toBe(
      true,
    );
  });

  it("creates a private state dir per impl name, hands it to the handler", async () => {
    let observedStateDir: string | undefined;
    const stateRoot = mkTmp();
    const registry = createPluginRegistry();
    registry.register(
      plugin("file", () => async (_c, ctx) => {
        observedStateDir = ctx.pluginStateDir;
      }),
    );

    const dispatcher = createDispatcher({
      manifest: manifest({ file: { impl: "file" } }),
      registry,
      env: {
        agentHome: mkTmp(),
        pluginStateRoot: stateRoot,
        log: vi.fn(),
      },
    });
    await dispatcher.apply([]);

    expect(observedStateDir).toBe(join(stateRoot, "file"));
    expect(existsSync(observedStateDir!)).toBe(true);
    expect(statSync(observedStateDir!).isDirectory()).toBe(true);
  });

  it("supports rebinding a kind from a built-in to an extension impl by name (override path)", async () => {
    // Verify the documented override workflow: an extension registers
    // under a fresh name; the manifest rebinds the kind to it; the
    // built-in plugin stays registered but never gets `.bind()`-ed.
    const builtinBind = vi.fn(() => async () => {});
    const overrideCalls = vi.fn(async () => {});
    const registry = createPluginRegistry();
    // Built-in registers first (as it would at boot).
    registry.register(plugin("skill-install", builtinBind));
    // Extension registers under a fresh name.
    registry.register(plugin("my-custom-skills", () => overrideCalls));

    const dispatcher = createDispatcher({
      manifest: manifest({
        "skill-ref": { impl: "my-custom-skills" },
      }),
      registry,
      env: env(),
    });
    await dispatcher.apply([]);

    expect(overrideCalls).toHaveBeenCalledOnce();
    expect(builtinBind).not.toHaveBeenCalled();
  });

  it("prefixes plugin log messages with the impl name", async () => {
    const logged: string[] = [];
    const registry = createPluginRegistry();
    registry.register(
      plugin("file", () => async (_c, ctx) => ctx.log("hello")),
    );

    const dispatcher = createDispatcher({
      manifest: manifest({ file: { impl: "file" } }),
      registry,
      env: {
        agentHome: mkTmp(),
        pluginStateRoot: mkTmp(),
        log: (m: string) => logged.push(m),
      },
    });
    await dispatcher.apply([]);

    expect(logged).toEqual(["[file] hello"]);
  });
});
