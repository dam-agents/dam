import {
  PLUGIN_PROTOCOL_VERSION,
  type Plugin,
  type PluginModule,
} from "agent-runtime-api";
import type { ExtensionImpl } from "../manifest.js";
import type { PluginRegistry } from "./plugin-registry.js";

export class ExtensionLoadError extends Error {
  constructor(
    message: string,
    public readonly extension: ExtensionImpl,
  ) {
    super(message);
    this.name = "ExtensionLoadError";
  }
}

export interface ExtensionLoader {
  load(
    impls: readonly ExtensionImpl[],
    registry: PluginRegistry,
  ): Promise<void>;
}

export function createExtensionLoader(deps?: {
  importModule?: (spec: string) => Promise<unknown>;
}): ExtensionLoader {
  const importModule = deps?.importModule ?? ((spec) => import(spec));
  return {
    async load(impls, registry) {
      for (const ext of impls) {
        const plugin = await resolveExtension(ext, importModule);
        registry.register(plugin);
      }
    },
  };
}

async function resolveExtension(
  ext: ExtensionImpl,
  importModule: (spec: string) => Promise<unknown>,
): Promise<Plugin> {
  let mod: unknown;
  try {
    mod = await importModule(ext.module);
  } catch (err) {
    throw new ExtensionLoadError(
      `failed to import extension module "${ext.module}": ${(err as Error).message}`,
      ext,
    );
  }
  if (!mod || typeof mod !== "object") {
    throw new ExtensionLoadError(
      `extension module "${ext.module}" did not resolve to an object`,
      ext,
    );
  }
  const namespace = mod as Record<string, unknown>;
  const exported = namespace[ext.export];
  if (exported === undefined) {
    throw new ExtensionLoadError(
      `extension module "${ext.module}" has no export named "${ext.export}"`,
      ext,
    );
  }
  if (!isPluginModule(exported)) {
    throw new ExtensionLoadError(
      `extension "${ext.name}" export "${ext.export}" from "${ext.module}" is not a valid PluginModule (missing pluginProtocolVersion or createPlugin)`,
      ext,
    );
  }
  if (exported.pluginProtocolVersion !== PLUGIN_PROTOCOL_VERSION) {
    throw new ExtensionLoadError(
      `extension "${ext.name}" requires plugin protocol v${exported.pluginProtocolVersion}; runtime channel expects v${PLUGIN_PROTOCOL_VERSION}`,
      ext,
    );
  }

  let plugin: Plugin;
  try {
    plugin = exported.createPlugin();
  } catch (err) {
    throw new ExtensionLoadError(
      `extension "${ext.name}" createPlugin() threw: ${(err as Error).message}`,
      ext,
    );
  }
  if (!isPlugin(plugin)) {
    throw new ExtensionLoadError(
      `extension "${ext.name}" createPlugin() returned an invalid Plugin (missing name or bind)`,
      ext,
    );
  }
  if (plugin.name !== ext.name) {
    throw new ExtensionLoadError(
      `extension "${ext.name}" plugin.name="${plugin.name}" — must match the manifest entry name`,
      ext,
    );
  }
  return plugin;
}

function isPluginModule(value: unknown): value is PluginModule {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.pluginProtocolVersion === "number" &&
    typeof obj.createPlugin === "function"
  );
}

function isPlugin(value: unknown): value is Plugin {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    (typeof obj.bind === "function" || typeof obj.bindEvent === "function")
  );
}
