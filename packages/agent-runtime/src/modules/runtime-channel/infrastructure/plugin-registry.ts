import type { Plugin } from "agent-runtime-api";

export interface PluginRegistry {
  register(plugin: Plugin): void;
  get(name: string): Plugin | null;
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
