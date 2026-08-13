import type { DriverBinding, KindHandler, Plugin } from "agent-runtime-api";
import { expandHome } from "../../../core/expand-home.js";
import type { EnvStateStore } from "../infrastructure/env-state-store.js";

const IMPL_NAME = "env";
const GH_TOKEN_ENV = "GH_TOKEN";
const GH_AVAILABLE_ENV = "PLATFORM_GH_TOKEN_AVAILABLE";
const KUBECONFIG_ENV = "KUBECONFIG";

export interface EnvChange {
  namesChanged: boolean;
}

export interface EnvPluginDeps {
  store: EnvStateStore;
  onChange?: (change: EnvChange) => void;
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
        for (const c of contributions) {
          if (c.kind !== "env") continue;
          if (c.name === KUBECONFIG_ENV) {
            env[c.name] = joinPathList(
              env[c.name],
              expandHome(c.placeholder, ctx.agentHome),
            );
          } else if (!Object.hasOwn(env, c.name)) {
            env[c.name] = c.placeholder;
          }
        }
        env[GH_AVAILABLE_ENV] = Object.hasOwn(env, GH_TOKEN_ENV)
          ? "true"
          : "false";

        const current = deps.store.current();
        if (envEquals(current, env)) {
          ctx.log("env unchanged");
          return;
        }
        const namesChanged = !sameNames(current, env);
        deps.store.write(env);
        ctx.log(
          `wrote ${Object.keys(env).length} env var(s)` +
            (namesChanged ? "" : " (values only)"),
        );
        deps.onChange?.({ namesChanged });
      };
    },
  };
}

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

function sameNames(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => Object.hasOwn(b, k));
}
