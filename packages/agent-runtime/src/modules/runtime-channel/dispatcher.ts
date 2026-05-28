import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Contribution,
  ContributionKind,
  DispatchContext,
  DriverFailure,
  KindHandler,
} from "agent-runtime-api";
import type { RuntimeManifest } from "./manifest.js";
import type { PluginRegistry } from "./infrastructure/plugin-registry.js";

export interface ContextEnv {
  readonly agentHome: string;
  readonly pluginStateRoot: string;
  log(msg: string): void;
}

export interface Dispatcher {
  /** Returns per-kind failures so the caller can report them up the wire.
   *  An empty array means every handler ran cleanly. Handlers that
   *  partially succeed (e.g. installed 1 of 2 skills) report their own
   *  details via `ctx.log`; only thrown errors land here. */
  apply(contributions: Contribution[]): Promise<DriverFailure[]>;
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
      for (const [kind, { handler, ctx }] of handlers) {
        const list = byKind.get(kind) ?? [];
        deps.env.log(
          `[dispatcher] kind=${kind} count=${list.length} — invoking`,
        );
        try {
          await handler(list, ctx);
          deps.env.log(`[dispatcher] kind=${kind} done`);
        } catch (err) {
          const message = (err as Error).message;
          deps.env.log(`[runtime] driver ${kind} failed: ${message}`);
          failures.push({ kind, message });
        }
      }
      return failures;
    },
  };
}
