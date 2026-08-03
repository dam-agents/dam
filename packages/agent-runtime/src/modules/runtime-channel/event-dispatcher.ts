import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  DispatchContext,
  DriverBinding,
  EventHandler,
  EventKind,
} from "agent-runtime-api";
import type { ContextEnv } from "./dispatcher.js";
import type { PluginRegistry } from "./infrastructure/plugin-registry.js";

export interface EventDispatcher {
  /** No-ops (logs) when the kind has no active driver. */
  invoke(kind: EventKind, payload: unknown): Promise<void>;
}

export function createEventDispatcher(deps: {
  drivers: Record<string, DriverBinding>;
  registry: PluginRegistry;
  env: ContextEnv;
}): EventDispatcher {
  const handlers = new Map<
    string,
    { handler: EventHandler; ctx: DispatchContext }
  >();
  const ensuredDirs = new Set<string>();

  function ensureStateDir(implName: string): string {
    const dir = join(deps.env.pluginStateRoot, implName);
    if (!ensuredDirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      ensuredDirs.add(dir);
    }
    return dir;
  }

  for (const [kind, binding] of Object.entries(deps.drivers)) {
    const plugin = deps.registry.get(binding.impl);
    if (!plugin) {
      throw new Error(
        `runtime-manifest binds event kind "${kind}" to impl "${binding.impl}" but no plugin with that name is registered`,
      );
    }
    if (!plugin.bindEvent) {
      throw new Error(
        `plugin "${binding.impl}" bound to event kind "${kind}" does not handle events (no bindEvent)`,
      );
    }
    const ctx: DispatchContext = {
      agentHome: deps.env.agentHome,
      pluginStateDir: ensureStateDir(plugin.name),
      log: (msg) => deps.env.log(`[${plugin.name}] ${msg}`),
    };
    handlers.set(kind, { handler: plugin.bindEvent(kind, binding), ctx });
  }

  return {
    async invoke(kind, payload) {
      const entry = handlers.get(kind);
      if (!entry) {
        deps.env.log(
          `[event-dispatcher] no handler for event kind "${kind}" — skipping`,
        );
        return;
      }
      await entry.handler(payload, entry.ctx);
    },
  };
}
