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
  const extra = spec.headers ?? {};
  if (!token) return extra;
  const credential: Record<string, string> =
    spec.credentialHeader === "x-api-key"
      ? { "x-api-key": token }
      : spec.credentialHeader === "authorization"
        ? { authorization: `Bearer ${token}` }
        : { authorization: `Bearer ${token}`, "x-api-key": token };
  return { ...extra, ...credential };
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

export interface DiscoveredModelInfo {
  contextWindow?: number;
  maxOutputTokens?: number;
  vision?: boolean;
  reasoning?: boolean;
  prices?: {
    inputPerToken: number;
    outputPerToken: number;
    cacheReadPerToken: number | null;
    cacheWritePerToken: number | null;
  };
}

export interface DiscoveredModel {
  id: string;
  name: string;
  info?: DiscoveredModelInfo;
}

export type ModelDiscoveryOutcome =
  | { status: "not-configured" }
  | {
      status: "observed";
      models: HarnessConfigChoice[];
      entries?: DiscoveredModel[];
      via: string;
    }
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

const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
const asBoolean = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

function liteLlmModelInfo(
  entry: Record<string, unknown>,
): DiscoveredModelInfo | undefined {
  const info = entry.model_info as Record<string, unknown> | null | undefined;
  if (!info || typeof info !== "object") return undefined;
  const input = asNumber(info.input_cost_per_token);
  const output = asNumber(info.output_cost_per_token);
  const out: DiscoveredModelInfo = {};
  const contextWindow = asNumber(info.max_input_tokens);
  if (contextWindow !== undefined) out.contextWindow = contextWindow;
  const maxOutputTokens =
    asNumber(info.max_output_tokens) ?? asNumber(info.max_tokens);
  if (maxOutputTokens !== undefined) out.maxOutputTokens = maxOutputTokens;
  const vision = asBoolean(info.supports_vision);
  if (vision !== undefined) out.vision = vision;
  const reasoning = asBoolean(info.supports_reasoning);
  if (reasoning !== undefined) out.reasoning = reasoning;
  if (
    typeof info.input_cost_per_token === "number" &&
    typeof info.output_cost_per_token === "number"
  ) {
    out.prices = {
      inputPerToken: input ?? 0,
      outputPerToken: output ?? 0,
      cacheReadPerToken: asNumber(info.cache_read_input_token_cost) ?? null,
      cacheWritePerToken:
        asNumber(info.cache_creation_input_token_cost) ?? null,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const listReaders: Record<
  ModelListShape,
  {
    listKey: string;
    id: (entry: Record<string, unknown>) => string | null;
    info?: (entry: Record<string, unknown>) => DiscoveredModelInfo | undefined;
  }
> = {
  "litellm-model-info": {
    listKey: "data",
    id: liteLlmModelName,
    info: liteLlmModelInfo,
  },
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
        const byId = new Map<string, DiscoveredModel>();
        for (const m of data) {
          const id = chatModelIdOf(m, shape);
          if (!id || byId.has(id)) continue;
          const info = listReaders[shape].info?.(m as Record<string, unknown>);
          byId.set(id, {
            id,
            name: publishedName(spec, id),
            ...(info && { info }),
          });
        }
        const entries = [...byId.values()].sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        if (entries.length === 0) {
          deps.log(
            `[harness-config] model discovery ${url} → empty model list`,
          );
          return { status: "unavailable" };
        }
        return {
          status: "observed",
          models: entries.map((e) => ({ value: e.name, name: e.name })),
          entries,
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
