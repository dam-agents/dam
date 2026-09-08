import type { HarnessConfigChoice } from "agent-runtime-api";
import type { ModelDiscoverySpec } from "../manifest.js";

type ModelListShape = NonNullable<ModelDiscoverySpec["shape"]>;

export type ModelDiscoveryOutcome =
  | { status: "not-configured" }
  | { status: "observed"; models: HarnessConfigChoice[] }
  | { status: "unavailable" };

export type ModelDiscovery = (
  spec: ModelDiscoverySpec | undefined,
  env: Record<string, string>,
) => Promise<ModelDiscoveryOutcome>;

const DISCOVERY_TIMEOUT_MS = 5_000;

const CONVERSATIONAL_MODES = new Set(["chat", "completion", "responses"]);

function discoveryUrl(spec: ModelDiscoverySpec, base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (spec.path) return `${trimmed}${spec.path}`;
  const root = /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${root}/models`;
}

function openAiModelId(entry: Record<string, unknown>): string | null {
  const { id } = entry;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function liteLlmModelName(entry: Record<string, unknown>): string | null {
  const mode = (entry.model_info as Record<string, unknown> | null)?.mode;
  if (typeof mode === "string" && !CONVERSATIONAL_MODES.has(mode)) return null;
  const name = entry.model_name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

function chatModelIdOf(entry: unknown, shape: ModelListShape): string | null {
  if (entry === null || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const id =
    shape === "litellm-model-info"
      ? liteLlmModelName(record)
      : openAiModelId(record);
  return id && !/embedding/i.test(id) ? id : null;
}

export function createModelDiscovery(deps: {
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

    const shape = spec.shape ?? "openai-models";
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
            const id = chatModelIdOf(m, shape);
            return id ? [id] : [];
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
