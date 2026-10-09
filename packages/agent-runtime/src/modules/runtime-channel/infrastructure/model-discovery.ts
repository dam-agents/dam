import type { HarnessConfigChoice } from "agent-runtime-api";
import type { ModelDiscoverySources, ModelDiscoverySpec } from "../manifest.js";

type ModelListShape = NonNullable<ModelDiscoverySpec["shape"]>;

export interface DiscoverySource {
  spec: ModelDiscoverySpec;
  via: string;
  base: string;
}

function credentialHeaders(
  spec: ModelDiscoverySpec,
  env: Record<string, string>,
): Record<string, string> {
  const token = spec.tokenEnv
    ?.map((name) => env[name]?.trim())
    .find((value) => !!value);
  return token ? { authorization: `Bearer ${token}`, "x-api-key": token } : {};
}

function discoverySources(
  sources: ModelDiscoverySources | undefined,
): readonly ModelDiscoverySpec[] {
  if (sources === undefined) return [];
  return Array.isArray(sources) ? sources : [sources];
}

export function selectDiscoverySource(
  sources: ModelDiscoverySources | undefined,
  env: Record<string, string>,
): DiscoverySource | null {
  for (const spec of discoverySources(sources)) {
    const via = spec.urlEnv.find((name) => !!env[name]?.trim());
    const base = via ? env[via]?.trim() : undefined;
    if (via && base) return { spec, via, base };
  }
  return null;
}

export type ModelDiscoveryOutcome =
  | { status: "not-configured" }
  | { status: "observed"; models: HarnessConfigChoice[]; via: string }
  | { status: "unavailable" };

export type ModelDiscovery = (
  spec: ModelDiscoverySources | undefined,
  env: Record<string, string>,
) => Promise<ModelDiscoveryOutcome>;

const DISCOVERY_TIMEOUT_MS = 6_000;
const DISCOVERY_ATTEMPTS = 2;

const CONVERSATIONAL_MODES = new Set(["chat", "completion", "responses"]);

function discoveryUrl(listing: { path?: string }, base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (listing.path) return `${trimmed}${listing.path}`;
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

function activeInferenceProfileId(
  entry: Record<string, unknown>,
): string | null {
  if (entry.status !== "ACTIVE") return null;
  const id = entry.inferenceProfileId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

const listReaders: Record<
  ModelListShape,
  { listKey: string; id: (entry: Record<string, unknown>) => string | null }
> = {
  "litellm-model-info": { listKey: "data", id: liteLlmModelName },
  "openai-models": { listKey: "data", id: openAiModelId },
  "bedrock-inference-profiles": {
    listKey: "inferenceProfileSummaries",
    id: activeInferenceProfileId,
  },
};

function publishedName(spec: ModelDiscoverySpec, id: string): string {
  const name = spec.lowercaseNames ? id.toLowerCase() : id;
  const prefix = spec.namePrefix ?? "";
  return name.startsWith(prefix) ? name : prefix + name;
}

function chatModelIdOf(entry: unknown, shape: ModelListShape): string | null {
  if (entry === null || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const id = listReaders[shape].id(record);
  return id && !/embed/i.test(id) ? id : null;
}

export function createModelDiscovery(deps: {
  log: (msg: string) => void;
  fetchImpl?: typeof globalThis.fetch;
}): ModelDiscovery {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;

  const list = async (
    url: string,
    shape: ModelListShape,
    spec: ModelDiscoverySpec,
    via: string,
    credentials: Record<string, string>,
  ): Promise<ModelDiscoveryOutcome | "refused"> => {
    for (let attempt = 1; attempt <= DISCOVERY_ATTEMPTS; attempt++) {
      const last = attempt === DISCOVERY_ATTEMPTS;
      try {
        const res = await doFetch(url, {
          headers: { accept: "application/json", ...credentials },
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (!res.ok) {
          deps.log(`[harness-config] model discovery ${url} → ${res.status}`);
          return "refused";
        }
        const body = (await res.json()) as Record<string, unknown>;
        const raw = body[listReaders[shape].listKey];
        const data = Array.isArray(raw) ? raw : null;
        if (!data) return { status: "unavailable" };
        const ids = [
          ...new Set(
            data.flatMap((m): string[] => {
              const id = chatModelIdOf(m, shape);
              return id ? [publishedName(spec, id)] : [];
            }),
          ),
        ].sort();
        if (ids.length === 0) {
          deps.log(
            `[harness-config] model discovery ${url} → empty model list`,
          );
          return { status: "unavailable" };
        }
        return {
          status: "observed",
          models: ids.map((id) => ({ value: id, name: id })),
          via,
        };
      } catch (err) {
        deps.log(
          `[harness-config] model discovery failed for ${url}: ${(err as Error).message}${last ? "" : " — retrying"}`,
        );
        if (last) return { status: "unavailable" };
      }
    }
    return { status: "unavailable" };
  };

  return async (sources, env) => {
    if (discoverySources(sources).length === 0) {
      return { status: "not-configured" };
    }
    const selected = selectDiscoverySource(sources, env);
    if (!selected) return { status: "not-configured" };
    const { spec, via, base } = selected;
    const credentials = credentialHeaders(spec, env);

    for (const listing of spec.fallback ? [spec, spec.fallback] : [spec]) {
      const outcome = await list(
        discoveryUrl(listing, base),
        listing.shape ?? "openai-models",
        spec,
        via,
        credentials,
      );
      if (outcome !== "refused") return outcome;
    }
    return { status: "unavailable" };
  };
}
