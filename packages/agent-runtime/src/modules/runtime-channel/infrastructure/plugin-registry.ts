import type { Plugin } from "agent-runtime-api";

/**
 * In-memory registry of plugins keyed by impl name (ADR-052). Built-in
 * plugins seed it during boot composition; extensions declared in the
 * manifest's `extensions.impls` are appended by the extension loader.
 * The dispatcher then looks up `binding.impl` to find the plugin that
 * binds a kind.
 *
 * Registration is one-shot — duplicate names throw at registration time
 * so a misconfigured manifest fails fast rather than silently masking a
 * built-in.
 */
export interface PluginRegistry {
  /** Register a plugin; throws on duplicate name. */
  register(plugin: Plugin): void;
  /** Resolve a plugin by impl name, or null when no plugin claims it. */
  get(name: string): Plugin | null;
  /** All registered plugin names — used for diagnostics + capability
   *  derivation cross-checks. */
  names(): readonly string[];
}

export function createPluginRegistry(): PluginRegistry {
  const byName = new Map<string, Plugin>();
  return {
    register(plugin) {
      if (byName.has(plugin.name)) {
        throw new Error(
          `plugin "${plugin.name}" already registered — extension impl names must not collide with built-ins`,
        );
      }
      byName.set(plugin.name, plugin);
    },
    get(name) {
      return byName.get(name) ?? null;
    },
    names() {
      return Array.from(byName.keys());
    },
  };
}
