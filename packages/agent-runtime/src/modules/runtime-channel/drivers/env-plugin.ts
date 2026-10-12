import type { DriverBinding, KindHandler, Plugin } from "agent-runtime-api";
import { expandHome } from "../../../core/expand-home.js";
import {
  leaseEnvOf,
  type EnvLayer,
  type EnvStateStore,
  type RuntimeEnvState,
} from "../infrastructure/env-state-store.js";

const IMPL_NAME = "env";
const GH_TOKEN_ENV = "GH_TOKEN";
const GH_ENTERPRISE_TOKEN_ENV = "GH_ENTERPRISE_TOKEN";
const GH_AVAILABLE_ENV = "PLATFORM_GH_TOKEN_AVAILABLE";
const KUBECONFIG_ENV = "KUBECONFIG";

export interface LayerChange {
  id: string;
  namesChanged: boolean;
}

export interface EnvChange {
  namesChanged: boolean;
  base: { namesChanged: boolean } | null;
  providers: LayerChange[];
  harnesses: LayerChange[];
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
        const providerEnv = new Map<string, Record<string, string>>();
        const harnessEnv = new Map<string, Record<string, string>>();
        for (const c of contributions) {
          if (c.kind !== "env") continue;
          const layer =
            c.provider !== undefined
              ? layerOf(providerEnv, c.provider)
              : c.harness !== undefined
                ? layerOf(harnessEnv, c.harness)
                : null;
          if (layer) {
            if (!Object.hasOwn(layer, c.name)) layer[c.name] = c.placeholder;
          } else if (c.name === KUBECONFIG_ENV) {
            env[c.name] = joinPathList(
              env[c.name],
              expandHome(c.placeholder, ctx.agentHome),
            );
          } else if (!Object.hasOwn(env, c.name)) {
            env[c.name] = c.placeholder;
          }
        }
        env[GH_AVAILABLE_ENV] =
          Object.hasOwn(env, GH_TOKEN_ENV) ||
          Object.hasOwn(env, GH_ENTERPRISE_TOKEN_ENV) ||
          env[GH_AVAILABLE_ENV] === "true"
            ? "true"
            : "false";
        const next: RuntimeEnvState = {
          env,
          providers: layersOf(providerEnv),
          harnesses: layersOf(harnessEnv),
        };

        const prev = deps.store.state();
        const base = envEquals(prev.env, next.env)
          ? null
          : { namesChanged: !sameNames(prev.env, next.env) };
        const providers = changedLayers(prev.providers, next.providers);
        const harnesses = changedLayers(prev.harnesses, next.harnesses);
        const defaultMoved = prev.providers[0]?.id !== next.providers[0]?.id;
        if (
          !base &&
          providers.length === 0 &&
          harnesses.length === 0 &&
          !defaultMoved
        ) {
          ctx.log("env unchanged");
          return;
        }
        deps.store.write(next);
        const defaultEnv = (s: RuntimeEnvState): Record<string, string> =>
          leaseEnvOf(s, {
            harness: null,
            provider: s.providers[0]?.id ?? null,
          });
        const namesChanged = !sameNames(defaultEnv(prev), defaultEnv(next));
        ctx.log(
          `wrote ${Object.keys(env).length} env var(s), ` +
            `${String(next.providers.length)} provider and ` +
            `${String(next.harnesses.length)} harness layer(s)` +
            (namesChanged ? "" : " (values only)"),
        );
        deps.onChange?.({ namesChanged, base, providers, harnesses });
      };
    },
  };
}

function layerOf(
  layers: Map<string, Record<string, string>>,
  id: string,
): Record<string, string> {
  const layer = layers.get(id) ?? {};
  layers.set(id, layer);
  return layer;
}

function layersOf(layers: Map<string, Record<string, string>>): EnvLayer[] {
  return [...layers].map(([id, env]) => ({ id, env }));
}

function changedLayers(prev: EnvLayer[], next: EnvLayer[]): LayerChange[] {
  const ids = new Set([...prev, ...next].map((l) => l.id));
  const out: LayerChange[] = [];
  for (const id of ids) {
    const before = prev.find((l) => l.id === id)?.env ?? {};
    const after = next.find((l) => l.id === id)?.env ?? {};
    if (envEquals(before, after)) continue;
    out.push({ id, namesChanged: !sameNames(before, after) });
  }
  return out;
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
