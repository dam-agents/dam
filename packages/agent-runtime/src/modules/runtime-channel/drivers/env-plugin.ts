import type { DriverBinding, KindHandler, Plugin } from "agent-runtime-api";
import { expandHome } from "../../../core/expand-home.js";
import type { EnvStateStore } from "../infrastructure/env-state-store.js";

const IMPL_NAME = "env";
const GH_TOKEN_ENV = "GH_TOKEN";
const GH_AVAILABLE_ENV = "PLATFORM_GH_TOKEN_AVAILABLE";
// A `:`-joined path list kubectl/oc merge at runtime, so multiple cluster
// connections compose instead of clobbering (each contributes one path).
const KUBECONFIG_ENV = "KUBECONFIG";

export interface EnvPluginDeps {
  /** The shared env store; the driver is its only writer. */
  store: EnvStateStore;
  /** Fired only when the written env changed, so a running harness can recycle. */
  onChange?: () => void;
}

export function createEnvPlugin(deps: EnvPluginDeps): Plugin {
  return {
    name: IMPL_NAME,

    bind(kind: string, _binding: DriverBinding): KindHandler {
      if (kind !== "env") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle kind "${kind}" — bind it to "env" only`,
        );
      }
      return async (contributions, ctx) => {
        const env: Record<string, string> = {};
        // First occurrence wins on collision (connection env precedes secret env),
        // except KUBECONFIG, whose paths are joined so clusters compose.
        for (const c of contributions) {
          if (c.kind !== "env") continue;
          if (c.name === KUBECONFIG_ENV) {
            // Resolve $HOME here — kubectl won't expand it in KUBECONFIG.
            env[c.name] = joinPathList(
              env[c.name],
              expandHome(c.placeholder, ctx.agentHome),
            );
          } else if (!(c.name in env)) {
            env[c.name] = c.placeholder;
          }
        }
        // Flag the harness wrapper scripts read for GitHub auth availability.
        env[GH_AVAILABLE_ENV] = GH_TOKEN_ENV in env ? "true" : "false";

        // Only rewrite + recycle when env actually changed (dispatcher fires on any snapshot change).
        if (envEquals(deps.store.current(), env)) {
          ctx.log("env unchanged");
          return;
        }
        deps.store.write(env);
        ctx.log(`wrote ${Object.keys(env).length} env var(s)`);
        deps.onChange?.();
      };
    },
  };
}

// Append `:`-separated paths, dropping duplicates and preserving order.
function joinPathList(existing: string | undefined, add: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...(existing?.split(":") ?? []), ...add.split(":")]) {
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out.join(":");
}

function envEquals(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}
