import type { HarnessConfigChoice } from "agent-runtime-api";

export interface ModelDiscoverySpec {
  // Env vars that may hold the provider base URL; first set wins.
  urlEnv: string[];
}

/**
 * What one discovery attempt concluded. The three cases are kept apart because
 * the platform records the list durably: "the provider offers nothing" is an
 * observation worth storing, while "the call didn't complete" must not be
 * allowed to erase a list an earlier attempt established.
 */
export type ModelDiscoveryOutcome =
  /** This harness declares no discovery source — a permanent property of it. */
  | { status: "not-configured" }
  /** The provider answered. `models` may legitimately be empty. */
  | { status: "observed"; models: HarnessConfigChoice[] }
  /** Declared, but the attempt yielded nothing usable: no base URL yet, a
   *  non-2xx, a malformed body, a timeout. Says nothing about the provider. */
  | { status: "unavailable" };

// Port: conclude what the provider currently offers. Infrastructure implements it.
export type ModelDiscovery = (
  spec: ModelDiscoverySpec | undefined,
  env: Record<string, string>,
) => Promise<ModelDiscoveryOutcome>;

const DISCOVERY_TIMEOUT_MS = 5_000;

// OpenAI `/v1/models` adapter for the ModelDiscovery port. The request rides the
// agent's egress (credentials injected on the wire), so no auth is attached here.
// Never throws. `fetchImpl` is injectable for tests.
export function createOpenAiModelDiscovery(deps: {
  log: (msg: string) => void;
  fetchImpl?: typeof globalThis.fetch;
}): ModelDiscovery {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  return async (spec, env) => {
    if (!spec) return { status: "not-configured" };
    const base = spec.urlEnv
      .map((name) => env[name]?.trim())
      .find((v): v is string => !!v);
    // Declared but the env hasn't materialized the URL yet — try again later.
    if (!base) return { status: "unavailable" };

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
        return { status: "unavailable" };
      }
      const body = (await res.json()) as { data?: unknown };
      const data = Array.isArray(body.data) ? body.data : null;
      if (!data) return { status: "unavailable" };
      const ids = [
        ...new Set(
          data.flatMap((m): string[] => {
            const id = (m as { id?: unknown } | null)?.id;
            // Drop embeddings — not chat models, so not pickable as a model.
            return typeof id === "string" && !/embedding/i.test(id) ? [id] : [];
          }),
        ),
      ].sort();
      // An empty list here is the provider's answer, not a failure: it offers
      // no chat models. Recorded as such, so it can clear a stale list.
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
