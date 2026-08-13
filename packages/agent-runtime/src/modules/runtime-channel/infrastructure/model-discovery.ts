import type { HarnessConfigChoice } from "agent-runtime-api";

export interface ModelDiscoverySpec {
  urlEnv: string[];
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
            return typeof id === "string" && !/embedding/i.test(id) ? [id] : [];
          }),
        ),
      ].sort();
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
