import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OpenAICompletionsCompat, Provider } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderConfig,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

declare const process: { env: Record<string, string | undefined> };

type ProviderSpec = {
  name: string;
  envPrefix: string;
  fallbackApiKeyEnv?: string;
  compat?: OpenAICompletionsCompat;
  shadows?: { name: string; urlEnv: string; apiKeyEnv?: string }[];
};

type DiscoveredModel = { id: string; contextWindow?: number };

type Activation = { name: string; model: string };

type BedrockModelEntry = {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
};

type ConfigState = {
  paths: { models: string; auth: string; settings: string };
  models: { providers: Record<string, ProviderConfig> };
  auth: Record<string, { type: string; key: string }>;
  settings: Record<string, unknown>;
};

const BEDROCK_PROVIDER = "amazon-bedrock";
const BEDROCK_API = "bedrock-converse-stream";
const BUILTIN_PROVIDERS_MODULE: string = "@earendil-works/pi-ai/providers/all";
const OPENAI_COMPLETIONS_MODULE: string = "@earendil-works/pi-ai/compat";
const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"];

type StreamSimple = NonNullable<ProviderConfig["streamSimple"]>;

const SPECS: ProviderSpec[] = [
  { name: "rits", envPrefix: "RITS" },
  {
    name: "openai-proxy",
    envPrefix: "OPENAI_PROXY",
    fallbackApiKeyEnv: "OPENAI_API_KEY",
    compat: {
      supportsUsageInStreaming: true,
      maxTokensField: "max_completion_tokens",
    },
    shadows: [
      {
        name: "openai",
        urlEnv: "OPENAI_BASE_URL",
        apiKeyEnv: "OPENAI_API_KEY",
      },
    ],
  },
];

const PRICE_VENDORS = [
  "anthropic",
  "openai",
  "google",
  "mistral",
  "deepseek",
  "xai",
];
const ROUTER_PROVIDER = "platform";
const ROUTER_BUILTINS_OFF = ["openai", "anthropic"];
const HARNESS_HEADER = "x-platform-harness";
const SESSION_HEADER = "x-platform-session";

type RouterModel = {
  id: string;
  metadata?: {
    alias?: string;
    upstreamId?: string;
    dialects?: string[];
    contextWindow?: number | null;
    maxOutputTokens?: number | null;
    reasoning?: boolean | null;
    vision?: boolean | null;
    cacheControl?: string | null;
    thinkingFormat?: string | null;
    prices?: {
      inputPerToken: number;
      outputPerToken: number;
      cacheReadPerToken: number | null;
      cacheWritePerToken: number | null;
    } | null;
  };
};

export default async function register(pi: ExtensionAPI): Promise<void> {
  const state = loadState();
  const platformModel = env("PLATFORM_MODEL");
  if (platformModel) state.settings.defaultModel = platformModel;
  const onBedrock = env("AWS_BEARER_TOKEN_BEDROCK") !== undefined;
  const clearedBedrock = onBedrock ? false : clearBedrockDefaults(state);

  const router = env("PLATFORM_MODEL_ROUTER_URL")?.replace(/\/+$/, "");
  if (router) {
    stampSession(pi);
    const activated = await activateRouter(pi, router, state);
    if (activated) {
      state.settings.defaultProvider = ROUTER_PROVIDER;
      state.settings.defaultModel = activated.model;
    }
    writeJson(state.paths.models, state.models);
    writeJson(state.paths.auth, state.auth);
    writeJson(state.paths.settings, state.settings);
    return;
  }

  let lastActivated: Activation | undefined;
  for (const spec of SPECS) {
    const activated = await activateSpec(pi, spec, state);
    if (activated) lastActivated = activated;
  }

  if (onBedrock) {
    await activateBedrock(pi, state);
    writeJson(state.paths.models, state.models);
    writeJson(state.paths.auth, state.auth);
    writeJson(state.paths.settings, state.settings);
  } else if (lastActivated) {
    persistState(state, lastActivated);
  } else if (clearedBedrock) {
    writeJson(state.paths.models, state.models);
    writeJson(state.paths.settings, state.settings);
  }
}

// UNIT_BOUNDARY_DESCRIPTION: the Model Router reads a Pi call's Session from x-platform-session. In a chat, Pi's own session id is the ACP session id; a terminal's PTY sets HARNESS_SESSION_ID to the platform's Session id, while Pi runs there under an id of its own that changes on /new. The event names no provider, so a call to the router is told apart by the router provider's own X-Platform-Harness header.
function stampSession(pi: ExtensionAPI): void {
  const terminalSession = env("HARNESS_SESSION_ID");
  pi.on("before_provider_headers", (event, ctx) => {
    const toRouter = Object.keys(event.headers).some(
      (name) => name.toLowerCase() === HARNESS_HEADER,
    );
    if (!toRouter) return;
    event.headers[SESSION_HEADER] =
      terminalSession ?? ctx.sessionManager.getSessionId();
  });
}

// UNIT_BOUNDARY_DESCRIPTION: with the Model Router, Pi holds one provider, "platform", whose models are the router's catalog, each on the API the model speaks best among the dialects its provider serves. The key is a placeholder that satisfies pi-acp's auth gate only. Pi's built-in openai and anthropic providers are turned off, since the keys in the machine's env are placeholders of Connections the router already serves.
async function activateRouter(
  pi: ExtensionAPI,
  router: string,
  state: ConfigState,
): Promise<Activation | undefined> {
  const url = `${router}/v1/models`;
  const deadline = Date.now() + intEnv("PI_ROUTER_LISTING_WAIT_MS", 30_000);
  let listed = await discoverRouterModels(url);
  while (listed.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    listed = await discoverRouterModels(url);
  }
  const off = [
    ...ROUTER_BUILTINS_OFF,
    ...SPECS.flatMap((s) => [s.name, ...(s.shadows ?? []).map((x) => x.name)]),
  ];
  for (const name of off) {
    pi.unregisterProvider(name);
    delete state.models.providers[name];
    delete state.auth[name];
  }
  if (listed.length === 0) {
    console.warn(
      `[pi-dynamic-providers] the model router lists no model yet${state.models.providers[ROUTER_PROVIDER] ? "; keeping the saved platform provider" : ""}`,
    );
    return undefined;
  }
  const provider: ProviderConfig = {
    baseUrl: `${router}/v1`,
    api: "openai-completions",
    apiKey: "platform:conn:router",
    authHeader: false,
    headers: { "X-Platform-Harness": "pi" },
    models: listed.map(routerModelConfig),
  };
  const streamSimple = await loadProviderStream(true);
  pi.registerProvider(
    ROUTER_PROVIDER,
    streamSimple ? { ...provider, streamSimple } : provider,
  );
  state.models.providers[ROUTER_PROVIDER] = provider;
  state.auth[ROUTER_PROVIDER] = {
    type: "api_key",
    key: provider.apiKey as string,
  };
  const requested = env("PLATFORM_MODEL")?.toLowerCase();
  const saved =
    state.settings.defaultProvider === ROUTER_PROVIDER &&
    typeof state.settings.defaultModel === "string"
      ? state.settings.defaultModel.toLowerCase()
      : undefined;
  const pick = (wanted: string | undefined) =>
    wanted ? listed.find((m) => m.id.toLowerCase() === wanted) : undefined;
  return {
    name: ROUTER_PROVIDER,
    model: (pick(requested) ?? pick(saved) ?? listed[0]).id,
  };
}

const RESPONSES_FAMILY = /(^|\/)(gpt-([5-9]|\d{2,})|o[1-9](?:-|$))/i;
const CLAUDE_FAMILY = /(^|\/)claude-/i;
const LITELLM_ALIASES = new Set(["ibm", "cb"]);

// UNIT_BOUNDARY_DESCRIPTION: only Anthropic's own API takes Pi's per-tool `eager_input_streaming` field, and the LiteLLM proxies refuse the whole request over it, so a Messages model on any other provider turns it off.
function routerModelConfig(model: RouterModel): ProviderModelConfig {
  const meta = model.metadata ?? {};
  const upstreamId = meta.upstreamId ?? model.id;
  const dialects = new Set(meta.dialects ?? []);
  const api =
    dialects.has("openai-responses") && RESPONSES_FAMILY.test(upstreamId)
      ? "openai-responses"
      : dialects.has("anthropic-messages") && CLAUDE_FAMILY.test(upstreamId)
        ? "anthropic-messages"
        : dialects.has("openai-chat")
          ? "openai-completions"
          : dialects.has("anthropic-messages")
            ? "anthropic-messages"
            : "openai-responses";
  const contextWindow = meta.contextWindow ?? 128000;
  const maxTokens = Math.min(meta.maxOutputTokens ?? 16384, contextWindow);
  const perMillion = (v: number | null | undefined) =>
    typeof v === "number" ? v * 1_000_000 : 0;
  return {
    id: model.id,
    name: model.id,
    api,
    input:
      meta.vision === false
        ? (["text"] as const)
        : (["text", "image"] as const),
    reasoning: meta.reasoning ?? RESPONSES_FAMILY.test(upstreamId),
    contextWindow,
    maxTokens,
    cost: {
      input: perMillion(meta.prices?.inputPerToken),
      output: perMillion(meta.prices?.outputPerToken),
      cacheRead: perMillion(meta.prices?.cacheReadPerToken),
      cacheWrite: perMillion(meta.prices?.cacheWritePerToken),
    },
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
      ...(meta.alias && LITELLM_ALIASES.has(meta.alias)
        ? { maxTokensField: "max_completion_tokens" as const }
        : {}),
      ...(meta.cacheControl === "anthropic"
        ? { cacheControlFormat: "anthropic" as const }
        : {}),
      ...(meta.thinkingFormat
        ? { thinkingFormat: meta.thinkingFormat as any }
        : {}),
      ...(api === "anthropic-messages" && meta.alias !== "anthropic"
        ? { supportsEagerToolInputStreaming: false }
        : {}),
    },
  };
}

async function discoverRouterModels(url: string): Promise<RouterModel[]> {
  try {
    const res = await fetch(url, {
      headers: { "X-Platform-Harness": "pi" },
      signal: AbortSignal.timeout(
        intEnv("PI_PROVIDER_DISCOVERY_TIMEOUT_MS", 5000),
      ),
    });
    if (!res.ok) {
      console.warn(
        `[pi-dynamic-providers] ${url}: HTTP ${res.status} ${res.statusText}`,
      );
      return [];
    }
    const json = (await res.json()) as { data?: unknown };
    if (!Array.isArray(json?.data)) return [];
    return json.data.filter(
      (m): m is RouterModel =>
        !!m &&
        typeof m === "object" &&
        typeof (m as RouterModel).id === "string",
    );
  } catch (err) {
    console.warn(
      `[pi-dynamic-providers] ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function activateSpec(
  pi: ExtensionAPI,
  spec: ProviderSpec,
  state: ConfigState,
): Promise<Activation | undefined> {
  const url = env(`${spec.envPrefix}_URL`)?.replace(/\/+$/, "");
  if (!url) return undefined;

  const baseUrl = /\/v\d+$/.test(url) ? url : `${url}/v1`;
  const apiKey =
    env(`${spec.envPrefix}_API_KEY`) ??
    (spec.fallbackApiKeyEnv ? env(spec.fallbackApiKeyEnv) : undefined) ??
    "dummy-placeholder";
  const requestedModel =
    env("PLATFORM_MODEL") ?? env(`${spec.envPrefix}_MODEL`);

  const discovered = await discoverModels(`${baseUrl}/models`, apiKey);
  const models =
    discovered.length > 0
      ? discovered
      : requestedModel
        ? [{ id: requestedModel }]
        : [];
  if (models.length === 0) return undefined;

  const builtin = await loadBuiltinProviders();

  const provider: ProviderConfig = {
    baseUrl,
    api: "openai-completions",
    apiKey,
    authHeader: false,
    models: models.map((m) =>
      buildModelConfig(spec, m, listPrice(builtin, m.id)),
    ),
  };

  const streamSimple = await loadProviderStream(
    spec.compat?.supportsUsageInStreaming === true,
  );
  pi.registerProvider(
    spec.name,
    streamSimple ? { ...provider, streamSimple } : provider,
  );
  state.models.providers[spec.name] = provider;
  state.auth[spec.name] = { type: "api_key", key: apiKey };

  applyShadows(pi, spec, url, state);

  const requestedLower = requestedModel?.toLowerCase();
  const defaultModel =
    models.find((m) => m.id.toLowerCase() === requestedLower)?.id ??
    models[0].id;
  return { name: spec.name, model: defaultModel };
}

async function loadProviderStream(
  raiseCutUsage: boolean,
): Promise<StreamSimple | undefined> {
  try {
    const { openAICompletionsApi, openAIResponsesApi, anthropicMessagesApi } =
      (await import(OPENAI_COMPLETIONS_MODULE)) as {
        openAICompletionsApi: () => { streamSimple: StreamSimple };
        openAIResponsesApi: () => { streamSimple: StreamSimple };
        anthropicMessagesApi: () => { streamSimple: StreamSimple };
      };
    return (model, context, options) => {
      if (model.api === "anthropic-messages")
        return anthropicMessagesApi().streamSimple(model, context, options);
      const { streamSimple } =
        model.api === "openai-responses"
          ? openAIResponsesApi()
          : openAICompletionsApi();
      return streamSimple(model, context, {
        ...options,
        fetch: providerStreamFetch(options?.fetch ?? fetch, raiseCutUsage),
      });
    };
  } catch (err) {
    console.warn(
      `[pi-dynamic-providers] ${OPENAI_COMPLETIONS_MODULE} unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

export function providerStreamFetch(
  inner: typeof fetch,
  raiseCutUsage = false,
): typeof fetch {
  return async (input, init) => {
    const cap = raiseCutUsage ? requestedCap(init?.body) : undefined;
    const raise =
      cap === undefined ? (line: string) => line : raiseCutOutputTo(cap);
    return rewriteEventStream(await inner(input, init), (line) =>
      splitMixedDelta(raise(line)),
    );
  };
}

function requestedCap(body: unknown): number | undefined {
  if (typeof body !== "string") return undefined;
  try {
    const { max_tokens, max_completion_tokens } = JSON.parse(body) as Record<
      string,
      unknown
    >;
    const cap = max_completion_tokens ?? max_tokens;
    return typeof cap === "number" && cap > 0 ? cap : undefined;
  } catch {
    return undefined;
  }
}

function raiseCutOutputTo(cap: number): (line: string) => string {
  let cut = false;
  return (line) => {
    if (!line.startsWith("data: {")) return line;
    let chunk: {
      choices?: ({ finish_reason?: unknown } | null)[];
      usage?: { completion_tokens?: unknown };
    };
    try {
      chunk = JSON.parse(line.slice("data: ".length));
    } catch {
      return line;
    }
    cut ||= chunk.choices?.some((c) => c?.finish_reason === "length") ?? false;
    const output = chunk.usage?.completion_tokens;
    if (!cut || typeof output !== "number" || output <= 0 || output >= cap)
      return line;
    return `data: ${JSON.stringify({ ...chunk, usage: { ...chunk.usage, completion_tokens: cap } })}`;
  };
}

function rewriteEventStream(
  res: Response,
  rewrite: (line: string) => string,
): Response {
  if (
    !res.body ||
    !res.headers.get("content-type")?.includes("text/event-stream")
  )
    return res;
  let pending = "";
  const lines = new TransformStream<string, string>({
    transform(text, controller) {
      const parts = (pending + text).split("\n");
      pending = parts.pop() ?? "";
      if (parts.length > 0)
        controller.enqueue(parts.map((line) => `${rewrite(line)}\n`).join(""));
    },
    flush(controller) {
      if (pending) controller.enqueue(rewrite(pending));
    },
  });
  const body = res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(lines)
    .pipeThrough(new TextEncoderStream());
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

function splitMixedDelta(line: string): string {
  if (!line.startsWith("data: {")) return line;
  let chunk: {
    choices?: ({ delta?: Record<string, unknown> | null } | null)[];
    usage?: unknown;
  };
  try {
    chunk = JSON.parse(line.slice("data: ".length));
  } catch {
    return line;
  }
  const isMixed = (delta: Record<string, unknown> | null | undefined) =>
    typeof delta?.content === "string" &&
    delta.content !== "" &&
    REASONING_FIELDS.some((f) => delta?.[f]);
  if (!chunk.choices?.some((c) => isMixed(c?.delta))) return line;
  const keeping = (keep: (field: string) => boolean) =>
    chunk.choices?.map((c) => ({
      ...c,
      delta: Object.fromEntries(
        Object.entries(c?.delta ?? {}).filter(([f]) => keep(f)),
      ),
    }));
  const { usage: _, ...head } = chunk;
  const reasoning = {
    ...head,
    choices: keeping((f) => f === "role" || REASONING_FIELDS.includes(f)),
  };
  const content = {
    ...chunk,
    choices: keeping((f) => !REASONING_FIELDS.includes(f)),
  };
  return `data: ${JSON.stringify(reasoning)}\n\ndata: ${JSON.stringify(content)}`;
}

function clearBedrockDefaults(state: ConfigState): boolean {
  const hadEntry = BEDROCK_PROVIDER in state.models.providers;
  delete state.models.providers[BEDROCK_PROVIDER];
  if (state.settings.defaultProvider !== BEDROCK_PROVIDER) return hadEntry;
  delete state.settings.defaultProvider;
  delete state.settings.defaultModel;
  return true;
}

async function activateBedrock(
  pi: ExtensionAPI,
  state: ConfigState,
): Promise<void> {
  const [providers, profiles] = await Promise.all([
    loadBuiltinProviders(),
    discoverBedrockProfiles(),
  ]);
  const builtin = providers.find((p) => p.id === BEDROCK_PROVIDER);
  const isBedrockModel = (id: string) =>
    hasModel(builtin, id) ||
    (profiles ?? []).some((p) => p.toLowerCase() === id.toLowerCase());
  const current =
    typeof state.settings.defaultModel === "string"
      ? state.settings.defaultModel.trim()
      : "";
  const provider = state.settings.defaultProvider;
  const kept =
    current &&
    (provider === BEDROCK_PROVIDER ||
      (provider === undefined && isBedrockModel(current)))
      ? current
      : undefined;
  const model = kept ?? env("AWS_BEDROCK_MODEL");

  state.settings.defaultProvider = BEDROCK_PROVIDER;
  if (model) {
    state.settings.defaultModel = model;
    if (!hasModel(builtin, model)) addBedrockModel(state, model);
  } else {
    delete state.settings.defaultModel;
  }

  if (builtin && profiles && profiles.length > 0)
    narrowBedrockModels(pi, builtin, profiles, model);
}

async function discoverBedrockProfiles(): Promise<string[] | undefined> {
  const base = env("AWS_ENDPOINT_URL_BEDROCK")?.replace(/\/+$/, "");
  if (!base) return undefined;
  const url = `${base}/inference-profiles?maxResults=1000`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(
        intEnv("PI_PROVIDER_DISCOVERY_TIMEOUT_MS", 5000),
      ),
    });
    if (!res.ok) {
      console.warn(
        `[pi-dynamic-providers] ${url}: HTTP ${res.status} ${res.statusText}`,
      );
      return undefined;
    }
    const json = (await res.json()) as { inferenceProfileSummaries?: unknown };
    if (!Array.isArray(json?.inferenceProfileSummaries)) {
      console.warn(
        `[pi-dynamic-providers] ${url}: response missing 'inferenceProfileSummaries'`,
      );
      return undefined;
    }
    const ids: string[] = [];
    for (const entry of json.inferenceProfileSummaries) {
      if (!entry || typeof entry !== "object") continue;
      const { status, inferenceProfileId } = entry as {
        status?: unknown;
        inferenceProfileId?: unknown;
      };
      if (
        status === "ACTIVE" &&
        typeof inferenceProfileId === "string" &&
        inferenceProfileId
      )
        ids.push(inferenceProfileId);
    }
    return ids;
  } catch (err) {
    console.warn(
      `[pi-dynamic-providers] ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

function narrowBedrockModels(
  pi: ExtensionAPI,
  builtin: Provider,
  profiles: readonly string[],
  keep: string | undefined,
): void {
  const wanted = new Set(profiles.map((id) => id.toLowerCase()));
  if (keep) wanted.add(keep.toLowerCase());
  const offered = (m: { id: string }) => wanted.has(m.id.toLowerCase());
  const models = builtin.getModels().filter(offered);
  if (models.length === 0) return;
  const allModels = builtin.getAllModels?.().filter(offered);
  pi.registerProvider({
    ...builtin,
    getModels: () => models,
    ...(allModels ? { getAllModels: () => allModels } : {}),
  });
}

async function loadBuiltinProviders(): Promise<readonly Provider[]> {
  try {
    const mod = (await import(BUILTIN_PROVIDERS_MODULE)) as {
      builtinProviders?: () => readonly Provider[];
    };
    return mod.builtinProviders?.() ?? [];
  } catch (err) {
    console.warn(
      `[pi-dynamic-providers] built-in providers unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

// UNIT_BOUNDARY_DESCRIPTION: a proxy reports no prices, so a proxy model costs what the model's own vendor lists in Pi's built-in catalog for the same bare id; a model no vendor lists counts as free.
function listPrice(
  providers: readonly Provider[],
  id: string,
): ProviderModelConfig["cost"] {
  const bare = id.slice(id.lastIndexOf("/") + 1).toLowerCase();
  for (const vendor of PRICE_VENDORS) {
    const model = providers
      .find((p) => p.id === vendor)
      ?.getModels()
      .find((m) => m.id.toLowerCase() === bare);
    if (model) return model.cost;
  }
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function hasModel(provider: Provider | undefined, id: string): boolean {
  const wanted = id.toLowerCase();
  return (provider?.getModels() ?? []).some(
    (m) => m.id.toLowerCase() === wanted,
  );
}

function addBedrockModel(state: ConfigState, id: string): void {
  const region = env("AWS_REGION") ?? "us-east-1";
  const entry: BedrockModelEntry = {
    id,
    name: id,
    api: BEDROCK_API,
    baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
  };
  const provider = (state.models.providers[BEDROCK_PROVIDER] ?? {}) as {
    models?: BedrockModelEntry[];
  };
  const others = (provider.models ?? []).filter((m) => m.id !== id);
  state.models.providers[BEDROCK_PROVIDER] = {
    ...provider,
    models: [...others, entry],
  } as unknown as ProviderConfig;
}

function applyShadows(
  pi: ExtensionAPI,
  spec: ProviderSpec,
  url: string,
  state: ConfigState,
): void {
  for (const shadow of spec.shadows ?? []) {
    const shadowUrl = env(shadow.urlEnv)?.replace(/\/+$/, "");
    if (!shadowUrl || shadowUrl !== url) continue;
    pi.unregisterProvider(shadow.name);
    delete state.models.providers[shadow.name];
    delete state.auth[shadow.name];
    if (shadow.apiKeyEnv) delete process.env[shadow.apiKeyEnv];
  }
}

// UNIT_BOUNDARY_DESCRIPTION: OpenAI-named proxy models use Responses for tools with reasoning, and GPT-5+ and o-series models reason, so Pi keeps their thinking level. Opaque aliases stay on Chat Completions until discovery supplies API metadata. The proxy caches a Claude prompt only when the request marks it, so Claude models get Anthropic cache markers.
function buildModelConfig(
  { envPrefix, compat }: ProviderSpec,
  model: DiscoveredModel,
  cost: ProviderModelConfig["cost"],
): ProviderModelConfig {
  const contextWindow =
    model.contextWindow ?? intEnv(`${envPrefix}_CONTEXT_WINDOW`, 128000);
  const maxTokens = Math.min(
    intEnv(`${envPrefix}_MAX_TOKENS`, 16384),
    contextWindow,
  );
  const responses =
    envPrefix === "OPENAI_PROXY" &&
    /(^|\/)(gpt-([5-9]|\d{2,})|o[1-9](?:-|$))/i.test(model.id);
  const claude =
    envPrefix === "OPENAI_PROXY" && /(^|\/)claude-/i.test(model.id);
  return {
    id: model.id,
    name: model.id,
    ...(responses ||
    (envPrefix === "OPENAI_PROXY" && /(^|\/)gpt-/i.test(model.id))
      ? { api: "openai-responses" }
      : {}),
    input: ["text"] as const,
    reasoning: responses || boolEnv(`${envPrefix}_REASONING`, false),
    contextWindow,
    maxTokens,
    cost,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      supportsUsageInStreaming: false,
      ...(envPrefix === "RITS"
        ? { maxTokensField: "max_tokens" as const }
        : {}),
      ...(claude ? { cacheControlFormat: "anthropic" as const } : {}),
      requiresThinkingAsText: boolEnv(`${envPrefix}_THINKING_AS_TEXT`, false),
      thinkingFormat: env(`${envPrefix}_THINKING_FORMAT`) as any,
      ...compat,
    },
  };
}

async function discoverModels(
  url: string,
  apiKey: string,
): Promise<DiscoveredModel[]> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(
        intEnv("PI_PROVIDER_DISCOVERY_TIMEOUT_MS", 5000),
      ),
    });
    if (!res.ok) {
      console.warn(
        `[pi-dynamic-providers] ${url}: HTTP ${res.status} ${res.statusText}`,
      );
      return [];
    }
    const json = (await res.json()) as { data?: unknown };
    if (!Array.isArray(json?.data)) {
      console.warn(
        `[pi-dynamic-providers] ${url}: response missing 'data' array`,
      );
      return [];
    }
    const seen = new Set<string>();
    const out: DiscoveredModel[] = [];
    for (const entry of json.data) {
      if (!entry || typeof entry !== "object") continue;
      const id = (entry as { id?: unknown }).id;
      const idLower = typeof id === "string" ? id.toLowerCase() : undefined;
      if (!idLower || seen.has(idLower)) continue;
      seen.add(idLower);
      const rawLen = (entry as { max_model_len?: unknown }).max_model_len;
      const contextWindow =
        typeof rawLen === "number" && Number.isFinite(rawLen) && rawLen > 0
          ? rawLen
          : undefined;
      out.push({ id: id as string, contextWindow });
    }
    return out;
  } catch (err) {
    console.warn(
      `[pi-dynamic-providers] ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

function loadState(): ConfigState {
  const dir = env("PI_CODING_AGENT_DIR") ?? join(homedir(), ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  const paths = {
    models: join(dir, "models.json"),
    auth: join(dir, "auth.json"),
    settings: join(dir, "settings.json"),
  };
  const models = readJson<{ providers?: Record<string, ProviderConfig> }>(
    paths.models,
  );
  return {
    paths,
    models: { providers: models?.providers ?? {} },
    auth:
      readJson<Record<string, { type: string; key: string }>>(paths.auth) ?? {},
    settings: readJson<Record<string, unknown>>(paths.settings) ?? {},
  };
}

function persistState(state: ConfigState, lastActivated: Activation): void {
  writeJson(state.paths.models, state.models);
  writeJson(state.paths.auth, state.auth);

  const chosen = resolveExistingDefault(state) ?? lastActivated;
  state.settings.defaultProvider = chosen.name;
  state.settings.defaultModel = chosen.model;
  writeJson(state.paths.settings, state.settings);
}

function resolveExistingDefault(state: ConfigState): Activation | undefined {
  const model = state.settings.defaultModel;
  if (typeof model !== "string" || model.length === 0) return undefined;
  const wanted = model.toLowerCase();
  const preferred = state.settings.defaultProvider;
  const names = [
    ...(typeof preferred === "string" ? [preferred] : []),
    ...Object.keys(state.models.providers),
  ];
  for (const name of names) {
    const hit = state.models.providers[name]?.models?.find(
      (m) => m.id.toLowerCase() === wanted,
    );
    if (hit) return { name, model: hit.id };
  }
  return undefined;
}

function readJson<T>(path: string): T | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}
function boolEnv(name: string, def: boolean): boolean {
  const v = env(name)?.toLowerCase();
  return v === undefined
    ? def
    : v === "true" || v === "1" || v === "yes" || v === "on";
}
function intEnv(name: string, def: number): number {
  const n = Number.parseInt(env(name) ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}
