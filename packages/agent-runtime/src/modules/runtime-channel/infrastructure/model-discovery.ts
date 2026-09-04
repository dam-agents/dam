import type { HarnessConfigChoice } from "agent-runtime-api";

export type ModelListShape = "openai-models" | "litellm-model-info";

export interface ModelDiscoverySpec {
  urlEnv: string[];
  defaultUrl?: string;
  path?: string;
  shape?: ModelListShape;
}

export type ModelDiscoveryOutcome =
  | { status: "not-configured" }
  | { status: "observed"; models: HarnessConfigChoice[] }
  | { status: "unavailable" };

export type ModelDiscovery = (
  spec: ModelDiscoverySpec | undefined,
  env: Record<string, string>,
) => Promise<ModelDiscoveryOutcome>;

const DISCOVERY_TIMEOUT_MS = 5_000;

function discoveryUrl(spec: ModelDiscoverySpec, base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (spec.path) return `${trimmed}${spec.path}`;
  const root = /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${root}/models`;
}

function modelIdOf(entry: unknown, shape: ModelListShape): string | null {
  const field = shape === "litellm-model-info" ? "model_name" : "id";
  const value = (entry as Record<string, unknown> | null)?.[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createModelDiscovery(deps: {
  log: (msg: string) => void;
  fetchImpl?: typeof globalThis.fetch;
}): ModelDiscovery {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  return async (spec, env) => {
    if (!spec) return { status: "not-configured" };
    const base =
      spec.urlEnv
        .map((name) => env[name]?.trim())
        .find((v): v is string => !!v) ?? spec.defaultUrl;
    if (!base) return { status: "unavailable" };

    const url = discoveryUrl(spec, base);
    try {
      const res = await doFetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) {
        deps.log(`[harness-config] model discovery ${url} → ${res.status}`);
        return { status: "unavailable" };
      }
      const body = (await res.json()) as { data?: unknown };
      const data = Array.isArray(body.data) ? body.data : null;
      if (!data) return { status: "unavailable" };
      const ids = [
        ...new Set(
          data.flatMap((m): string[] => {
            const id = modelIdOf(m, spec.shape ?? "openai-models");
            return id && !/embedding/i.test(id) ? [id] : [];
          }),
        ),
      ].sort();
      if (ids.length === 0) {
        deps.log(`[harness-config] model discovery ${url} → empty model list`);
        return { status: "unavailable" };
      }
      return {
        status: "observed",
        models: ids.map((id) => ({ value: id, name: id })),
      };
    } catch (err) {
      deps.log(
        `[harness-config] model discovery failed for ${url}: ${(err as Error).message}`,
      );
      return { status: "unavailable" };
    }
  };
}
