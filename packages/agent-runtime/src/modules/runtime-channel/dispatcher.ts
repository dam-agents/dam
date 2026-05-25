import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Contribution,
  ContributionKind,
  DispatchContext,
  KindHandler,
} from "agent-runtime-api";
import type { RuntimeManifest } from "./manifest.js";
import type { PluginRegistry } from "./infrastructure/plugin-registry.js";

/**
 * Per-kind dispatcher (ADR-052). Pure registry binder — at compose
 * time, the dispatcher walks the manifest's drivers map, looks each
 * `binding.impl` up in the {@link PluginRegistry}, calls
 * `plugin.bind(kind, binding)` once per kind to obtain a per-kind
 * handler, and caches the result. On every `applyState` push the
 * dispatcher routes each Contribution to its kind's cached handler.
 *
 * No `switch` on kind anywhere — adding a new kind is one new entry in
 * the manifest plus one plugin registered (built-in at compose, or
 * dynamic-imported from `extensions.impls`).
 */

export interface ContextEnv {
  /** Agent's HOME — the boundary inside which plugins are allowed to
   *  read/write. */
  readonly agentHome: string;
  /** Root for plugin-private state directories. One subdir per impl
   *  name is created lazily on first use. */
  readonly pluginStateRoot: string;
  log(msg: string): void;
}

export interface Dispatcher {
  /** Reconcile contributions to disk for the kinds the manifest binds. */
  apply(contributions: Contribution[]): Promise<void>;
}

export function createDispatcher(deps: {
  manifest: RuntimeManifest;
  registry: PluginRegistry;
  env: ContextEnv;
}): Dispatcher {
  const handlers = new Map<
    ContributionKind,
    { handler: KindHandler; ctx: DispatchContext }
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

  for (const [kindRaw, binding] of Object.entries(deps.manifest.drivers)) {
    const kind = kindRaw as ContributionKind;
    const plugin = deps.registry.get(binding.impl);
    if (!plugin) {
      throw new Error(
        `runtime-manifest binds kind "${kind}" to impl "${binding.impl}" but no plugin with that name is registered`,
      );
    }
    const handler = plugin.bind(kind, binding);
    const ctx: DispatchContext = {
      agentHome: deps.env.agentHome,
      pluginStateDir: ensureStateDir(plugin.name),
      log: (msg) => deps.env.log(`[${plugin.name}] ${msg}`),
    };
    handlers.set(kind, { handler, ctx });
  }

  return {
    async apply(contributions: Contribution[]): Promise<void> {
      const byKind = new Map<ContributionKind, Contribution[]>();
      // Initialize buckets for every bound kind so a handler always
      // receives a list, even an empty one — that's how reconcilers
      // detect removal on the desired-set semantics.
      for (const kind of handlers.keys()) byKind.set(kind, []);
      for (const c of contributions) {
        const list = byKind.get(c.kind);
        if (!list) continue; // unbound kind — capability filter should already drop these
        list.push(c);
      }
      for (const [kind, { handler, ctx }] of handlers) {
        const list = byKind.get(kind) ?? [];
        try {
          await handler(list, ctx);
        } catch (err) {
          deps.env.log(
            `[runtime] driver ${kind} failed: ${(err as Error).message}`,
          );
        }
      }
    },
  };
}
