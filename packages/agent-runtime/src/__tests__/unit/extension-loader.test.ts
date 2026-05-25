import { describe, it, expect } from "vitest";
import {
  PLUGIN_PROTOCOL_VERSION,
  type Plugin,
  type PluginModule,
} from "agent-runtime-api";
import {
  ExtensionLoadError,
  createExtensionLoader,
} from "../../modules/runtime-channel/infrastructure/extension-loader.js";
import { createPluginRegistry } from "../../modules/runtime-channel/infrastructure/plugin-registry.js";

function pluginModule(name: string, opts: Partial<PluginModule> = {}): unknown {
  const plugin: Plugin = {
    name,
    bind: () => async () => {},
  };
  return {
    pluginProtocolVersion:
      opts.pluginProtocolVersion ?? PLUGIN_PROTOCOL_VERSION,
    createPlugin: opts.createPlugin ?? (() => plugin),
  };
}

function loaderWithModules(modules: Record<string, unknown>) {
  return createExtensionLoader({
    importModule: async (spec) => {
      if (!(spec in modules)) {
        throw new Error(`module not found: ${spec}`);
      }
      return modules[spec];
    },
  });
}

describe("ExtensionLoader", () => {
  it("loads a valid extension and registers it", async () => {
    const registry = createPluginRegistry();
    const loader = loaderWithModules({
      "@org/ext": { default: pluginModule("custom") },
    });

    await loader.load(
      [{ name: "custom", module: "@org/ext", export: "default" }],
      registry,
    );

    expect(registry.get("custom")).not.toBeNull();
  });

  it("fails fast when the module path doesn't resolve", async () => {
    const registry = createPluginRegistry();
    const loader = loaderWithModules({});

    await expect(
      loader.load(
        [{ name: "custom", module: "@org/missing", export: "default" }],
        registry,
      ),
    ).rejects.toThrow(ExtensionLoadError);
  });

  it("fails fast when the named export is absent", async () => {
    const registry = createPluginRegistry();
    const loader = loaderWithModules({
      "@org/ext": { somethingElse: pluginModule("custom") },
    });

    await expect(
      loader.load(
        [{ name: "custom", module: "@org/ext", export: "default" }],
        registry,
      ),
    ).rejects.toThrow(/no export named "default"/);
  });

  it("fails fast when the protocol version mismatches", async () => {
    const registry = createPluginRegistry();
    const loader = loaderWithModules({
      "@org/ext": {
        default: pluginModule("custom", {
          pluginProtocolVersion: 999 as never,
        }),
      },
    });

    await expect(
      loader.load(
        [{ name: "custom", module: "@org/ext", export: "default" }],
        registry,
      ),
    ).rejects.toThrow(/requires plugin protocol v999/);
  });

  it("fails fast when createPlugin throws", async () => {
    const registry = createPluginRegistry();
    const loader = loaderWithModules({
      "@org/ext": {
        default: pluginModule("custom", {
          createPlugin: () => {
            throw new Error("boom");
          },
        }),
      },
    });

    await expect(
      loader.load(
        [{ name: "custom", module: "@org/ext", export: "default" }],
        registry,
      ),
    ).rejects.toThrow(/createPlugin\(\) threw: boom/);
  });

  it("fails fast when the plugin name doesn't match the manifest entry", async () => {
    const registry = createPluginRegistry();
    const loader = loaderWithModules({
      "@org/ext": { default: pluginModule("not-the-same-name") },
    });

    await expect(
      loader.load(
        [{ name: "custom", module: "@org/ext", export: "default" }],
        registry,
      ),
    ).rejects.toThrow(/must match the manifest entry name/);
  });

  it("rejects extensions whose name collides with an already-registered built-in", async () => {
    const registry = createPluginRegistry();
    registry.register({
      name: "file",
      bind: () => async () => {},
    });
    const loader = loaderWithModules({
      "@org/evil": { default: pluginModule("file") },
    });

    await expect(
      loader.load(
        [{ name: "file", module: "@org/evil", export: "default" }],
        registry,
      ),
    ).rejects.toThrow(/already registered/);
  });
});
