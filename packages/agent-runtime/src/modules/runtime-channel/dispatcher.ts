import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Contribution,
  ContributionKind,
  DispatchContext,
  DriverBinding,
  DriverFailure,
  EventHandler,
  EventKind,
  KindHandler,
  Plugin,
} from "agent-runtime-api";
import type { PluginRegistry } from "./infrastructure/plugin-registry.js";

export interface ContextEnv {
  readonly agentHome: string;
  readonly pluginStateRoot: string;
  log(msg: string): void;
}

interface DispatcherDeps {
  drivers: Record<string, DriverBinding>;
  registry: PluginRegistry;
  env: ContextEnv;
}

export interface ScopedBinding {
  binding: DriverBinding;
  scope: string | null;
}

function contextFor(
  env: ContextEnv,
  plugin: Plugin,
  scope: string | null = null,
): DispatchContext {
  const pluginStateDir = join(
    env.pluginStateRoot,
    plugin.name,
    ...(scope === null ? [] : [`@${scope}`]),
  );
  mkdirSync(pluginStateDir, { recursive: true });
  return {
    agentHome: env.agentHome,
    pluginStateDir,
    log: (msg) => env.log(`[${plugin.name}] ${msg}`),
  };
}

export interface Dispatcher {
  apply(contributions: Contribution[]): Promise<DriverFailure[]>;
}

export function createDispatcher(deps: {
  drivers: Record<string, ScopedBinding[]>;
  registry: PluginRegistry;
  env: ContextEnv;
}): Dispatcher {
  const handlers = new Map<
    ContributionKind,
    { handler: KindHandler; ctx: DispatchContext }[]
  >();

  for (const [kindRaw, bindings] of Object.entries(deps.drivers)) {
    const kind = kindRaw as ContributionKind;
    for (const { binding, scope } of bindings) {
      const plugin = deps.registry.get(binding.impl);
      if (!plugin) {
        throw new Error(
          `runtime-manifest binds kind "${kind}" to impl "${binding.impl}" but no plugin with that name is registered`,
        );
      }
      if (!plugin.bind) {
        throw new Error(
          `plugin "${binding.impl}" bound to contribution kind "${kind}" does not handle contributions (no bind)`,
        );
      }
      const handler = plugin.bind(kind, binding);
      handlers.set(kind, [
        ...(handlers.get(kind) ?? []),
        { handler, ctx: contextFor(deps.env, plugin, scope) },
      ]);
    }
  }

  return {
    async apply(contributions: Contribution[]): Promise<DriverFailure[]> {
      const byKind = new Map<ContributionKind, Contribution[]>();
      for (const kind of handlers.keys()) byKind.set(kind, []);
      let unhandled = 0;
      for (const c of contributions) {
        const list = byKind.get(c.kind);
        if (!list) {
          unhandled++;
          continue;
        }
        list.push(c);
      }
      if (unhandled > 0) {
        deps.env.log(
          `[dispatcher] ${unhandled} contribution(s) had no kind handler — manifest does not bind their kind`,
        );
      }
      const failures: DriverFailure[] = [];
      for (const [kind, bound] of handlers) {
        const list = byKind.get(kind) ?? [];
        deps.env.log(
          `[dispatcher] kind=${kind} count=${list.length} — invoking`,
        );
        for (const { handler, ctx } of bound) {
          try {
            await handler(list, ctx);
            deps.env.log(`[dispatcher] kind=${kind} done`);
          } catch (err) {
            const message = (err as Error).message;
            deps.env.log(`[runtime] driver ${kind} failed: ${message}`);
            failures.push({ kind, message });
          }
        }
      }
      return failures;
    },
  };
}

export interface EventDispatcher {
  invoke(kind: EventKind, payload: unknown, eventId: string): Promise<void>;
}

export function createEventDispatcher(deps: DispatcherDeps): EventDispatcher {
  const handlers = new Map<
    string,
    { handler: EventHandler; ctx: DispatchContext }
  >();

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
    const ctx = contextFor(deps.env, plugin);
    handlers.set(kind, { handler: plugin.bindEvent(kind, binding), ctx });
  }

  return {
    async invoke(kind, payload, eventId) {
      const entry = handlers.get(kind);
      if (!entry) {
        deps.env.log(
          `[event-dispatcher] no handler for event kind "${kind}" — skipping`,
        );
        return;
      }
      await entry.handler(payload, { ...entry.ctx, eventId });
    },
  };
}
