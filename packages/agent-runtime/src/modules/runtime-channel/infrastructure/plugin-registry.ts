import type {
  DriverBinding,
  EventHandler,
  KindHandler,
  Plugin,
} from "agent-runtime-api";

export interface PluginRegistry {
  register(plugin: Plugin): void;
  get(name: string): Plugin | null;
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
  };
}

export function contributionPlugin(
  name: string,
  kind: string,
  handler: (binding: DriverBinding) => KindHandler,
): Plugin {
  return {
    name,
    bind(bindKind, binding) {
      if (bindKind !== kind) {
        throw new Error(
          `plugin "${name}" does not handle kind "${bindKind}" — bind it to "${kind}" only`,
        );
      }
      return handler(binding);
    },
  };
}

export function eventPlugin(
  name: string,
  kind: string,
  handler: EventHandler,
): Plugin {
  return {
    name,
    bindEvent(bindKind) {
      if (bindKind !== kind) {
        throw new Error(
          `plugin "${name}" does not handle event kind "${bindKind}"`,
        );
      }
      return handler;
    },
  };
}
