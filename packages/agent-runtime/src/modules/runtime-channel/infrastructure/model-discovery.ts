import type { HarnessConfigChoice } from "agent-runtime-api";

export interface ModelDiscoverySpec {
  // Env vars that may hold the provider base URL; first set wins.
  urlEnv: string[];
}

// Port: resolve the available model list, or null when not configured / on any
// failure (caller falls back to the static catalog). Infrastructure implements it.
export type ModelDiscovery = (
  spec: ModelDiscoverySpec | undefined,
  env: Record<string, string>,
) => Promise<HarnessConfigChoice[] | null>;

const DISCOVERY_TIMEOUT_MS = 5_000;

// OpenAI `/v1/models` adapter for the ModelDiscovery port. The request rides the
// agent's egress (credentials injected on the wire), so no auth is attached here.
// Any failure yields null, never throws. `fetchImpl` is injectable for tests.
export function createOpenAiModelDiscovery(deps: {
  log: (msg: string) => void;
  fetchImpl?: typeof globalThis.fetch;
}): ModelDiscovery {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  return async (spec, env) => {
    if (!spec) return null;
    const base = spec.urlEnv
      .map((name) => env[name]?.trim())
      .find((v): v is string => !!v);
    if (!base) return null;

    const trimmed = base.replace(/\/+$/, "");
    const root = /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
    const url = `${root}/models`;
    try {
      const res = await doFetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) {
        deps.log(`[harness-config] model discovery ${url} → ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { data?: unknown };
      const data = Array.isArray(body.data) ? body.data : null;
      if (!data) return null;
      const ids = [
        ...new Set(
          data.flatMap((m): string[] => {
            const id = (m as { id?: unknown } | null)?.id;
            // Drop embeddings — not chat models, so not pickable as a model.
            return typeof id === "string" && !/embedding/i.test(id) ? [id] : [];
          }),
        ),
      ].sort();
      return ids.length ? ids.map((id) => ({ value: id, name: id })) : null;
    } catch (err) {
      deps.log(
        `[harness-config] model discovery failed for ${url}: ${(err as Error).message}`,
      );
      return null;
    }
  };
}
