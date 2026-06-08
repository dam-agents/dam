import type { DriverBinding, KindHandler, Plugin } from "agent-runtime-api";
import type { EnvStateStore } from "../infrastructure/env-state-store.js";

const IMPL_NAME = "env";
const GH_TOKEN_ENV = "GH_TOKEN";
const GH_AVAILABLE_ENV = "PLATFORM_GH_TOKEN_AVAILABLE";

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
        // First occurrence wins on collision (connection env precedes secret env).
        for (const c of contributions) {
          if (c.kind !== "env") continue;
          if (!(c.name in env)) env[c.name] = c.placeholder;
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

function envEquals(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

export const ENV_PLUGIN_NAME = IMPL_NAME;
