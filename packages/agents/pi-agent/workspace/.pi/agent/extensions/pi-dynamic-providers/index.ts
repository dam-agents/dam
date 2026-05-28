import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

declare const process: { env: Record<string, string | undefined> };

// Each spec is activated when ${envPrefix}_URL is set on the pod. Models are
// discovered from the OpenAI-compatible /v1/models endpoint; ${envPrefix}_MODEL
// is optional and only used to pick the default when it appears in the
// discovered list. If discovery fails, we fall back to a single-model
// registration as long as ${envPrefix}_MODEL is set — otherwise the spec is
// skipped.
//
// Auth is injected on the wire by the Envoy sidecar's credential_injector
// filter; the apiKey here only exists to satisfy pi-acp's per-session
// auth gate (reads models.json.apiKey + auth.json), and the discovery fetch
// intentionally does not set Authorization so envoy can inject it the same way
// it does for the actual model traffic.

type ProviderSpec = {
	name: string;
	envPrefix: string;
	// If this spec activates and ${envPrefix}_URL matches the shadow's urlEnv,
	// hide the named provider as a duplicate alias. apiKeyEnv is unset so
	// built-in providers (whose auth is discovered via pi-ai env-api-keys) are
	// filtered out of getAvailable() — pi.unregisterProvider() alone only
	// affects dynamically-registered providers.
	shadows?: { name: string; urlEnv: string; apiKeyEnv?: string }[];
};

type DiscoveredModel = { id: string; contextWindow?: number };

type Activation = { name: string; model: string };

type ConfigState = {
	paths: { models: string; auth: string; settings: string };
	models: { providers: Record<string, ProviderConfig> };
	auth: Record<string, { type: string; key: string }>;
	settings: Record<string, unknown>;
};

const SPECS: ProviderSpec[] = [
	{ name: "rits", envPrefix: "RITS" },
	{
		name: "openai-proxy",
		envPrefix: "OPENAI_PROXY",
		shadows: [{ name: "openai", urlEnv: "OPENAI_BASE_URL", apiKeyEnv: "OPENAI_API_KEY" }],
	},
];

export default async function register(pi: ExtensionAPI): Promise<void> {
	const state = loadState();

	let lastActivated: Activation | undefined;
	for (const spec of SPECS) {
		const activated = await activateSpec(pi, spec, state);
		if (activated) lastActivated = activated;
	}

	if (lastActivated) persistState(state, lastActivated);
}

async function activateSpec(pi: ExtensionAPI, spec: ProviderSpec, state: ConfigState): Promise<Activation | undefined> {
	const url = env(`${spec.envPrefix}_URL`)?.replace(/\/+$/, "");
	if (!url) return undefined;

	const baseUrl = /\/v\d+$/.test(url) ? url : `${url}/v1`;
	const apiKey = env(`${spec.envPrefix}_API_KEY`) ?? "dummy-placeholder";
	const requestedModel = env(`${spec.envPrefix}_MODEL`);

	const discovered = await discoverModels(`${baseUrl}/models`);
	const models = discovered.length > 0 ? discovered : requestedModel ? [{ id: requestedModel }] : [];
	if (models.length === 0) return undefined;

	const provider: ProviderConfig = {
		baseUrl,
		api: "openai-completions",
		apiKey,
		authHeader: false,
		models: models.map((m) => buildModelConfig(spec.envPrefix, m)),
	};

	pi.registerProvider(spec.name, provider);
	state.models.providers[spec.name] = provider;
	state.auth[spec.name] = { type: "api_key", key: apiKey };

	applyShadows(pi, spec, url, state);

	// Use the requested model as the default only when it appears in the
	// discovered list (case-insensitive — proxies are inconsistent about
	// casing); otherwise fall back to the first discovered model. The
	// discovered id is preferred so the casing we send matches the upstream.
	const requestedLower = requestedModel?.toLowerCase();
	const defaultModel = models.find((m) => m.id.toLowerCase() === requestedLower)?.id ?? models[0].id;
	return { name: spec.name, model: defaultModel };
}

function applyShadows(pi: ExtensionAPI, spec: ProviderSpec, url: string, state: ConfigState): void {
	for (const shadow of spec.shadows ?? []) {
		const shadowUrl = env(shadow.urlEnv)?.replace(/\/+$/, "");
		if (!shadowUrl || shadowUrl !== url) continue;
		pi.unregisterProvider(shadow.name);
		delete state.models.providers[shadow.name];
		delete state.auth[shadow.name];
		if (shadow.apiKeyEnv) delete process.env[shadow.apiKeyEnv];
	}
}

function buildModelConfig(envPrefix: string, model: DiscoveredModel): ProviderModelConfig {
	const contextWindow = model.contextWindow ?? intEnv(`${envPrefix}_CONTEXT_WINDOW`, 128000);
	// vLLM exposes max_model_len (total input+output). Capping maxTokens at it
	// prevents requesting more output than the model can physically produce.
	const maxTokens = Math.min(intEnv(`${envPrefix}_MAX_TOKENS`, 16384), contextWindow);
	return {
		id: model.id,
		name: model.id,
		input: ["text"] as const,
		reasoning: boolEnv(`${envPrefix}_REASONING`, false),
		contextWindow,
		maxTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		compat: {
			// vLLM and most OpenAI-compatible proxies don't speak these.
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			supportsUsageInStreaming: false,
			maxTokensField: "max_tokens",
			requiresThinkingAsText: boolEnv(`${envPrefix}_THINKING_AS_TEXT`, false),
			thinkingFormat: env(`${envPrefix}_THINKING_FORMAT`) as any,
		},
	};
}

async function discoverModels(url: string): Promise<DiscoveredModel[]> {
	// Discovery is best-effort: pod startup may race the upstream proxy, the
	// endpoint may be missing, or the response may be malformed. The caller
	// falls back to env-defined single-model registration; we still warn so
	// operators have a signal when discovery silently degrades.
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(intEnv("PI_PROVIDER_DISCOVERY_TIMEOUT_MS", 5000)) });
		if (!res.ok) {
			console.warn(`[pi-dynamic-providers] ${url}: HTTP ${res.status} ${res.statusText}`);
			return [];
		}
		const json = (await res.json()) as { data?: unknown };
		if (!Array.isArray(json?.data)) {
			console.warn(`[pi-dynamic-providers] ${url}: response missing 'data' array`);
			return [];
		}
		const seen = new Set<string>();
		const out: DiscoveredModel[] = [];
		for (const entry of json.data) {
			if (!entry || typeof entry !== "object") continue;
			const id = (entry as { id?: unknown }).id;
			const idLower = typeof id === "string" ? id.toLowerCase() : undefined;
			if (!idLower || idLower.length === 0 || seen.has(idLower)) continue;
			seen.add(idLower);
			const rawLen = (entry as { max_model_len?: unknown }).max_model_len;
			const contextWindow = typeof rawLen === "number" && Number.isFinite(rawLen) && rawLen > 0 ? rawLen : undefined;
			out.push({ id: id as string, contextWindow });
		}
		return out;
	} catch (err) {
		console.warn(`[pi-dynamic-providers] ${url}: ${err instanceof Error ? err.message : String(err)}`);
		return [];
	}
}

function loadState(): ConfigState {
	const dir = join(homedir(), ".pi", "agent");
	mkdirSync(dir, { recursive: true });
	const paths = {
		models: join(dir, "models.json"),
		auth: join(dir, "auth.json"),
		settings: join(dir, "settings.json"),
	};
	const models = readJson<{ providers?: Record<string, ProviderConfig> }>(paths.models);
	return {
		paths,
		models: { providers: models?.providers ?? {} },
		auth: readJson<Record<string, { type: string; key: string }>>(paths.auth) ?? {},
		settings: readJson<Record<string, unknown>>(paths.settings) ?? {},
	};
}

function persistState(state: ConfigState, lastActivated: Activation): void {
	// pi-acp re-checks models.json/auth.json on every session/prompt; runtime
	// registerProvider() is invisible to that check, so mirror to disk.
	// Upstream: https://github.com/svkozak/pi-acp/issues/15
	writeJson(state.paths.models, state.models);
	writeJson(state.paths.auth, state.auth);

	// Make the last-activated provider the session default without losing any
	// other settings already configured in the workspace.
	state.settings.defaultProvider = lastActivated.name;
	state.settings.defaultModel = lastActivated.model;
	writeJson(state.paths.settings, state.settings);
}

function readJson<T>(path: string): T | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as T) : undefined;
	} catch {
		// File may not exist yet on a fresh home, or may be malformed; the
		// caller treats undefined as "start from empty".
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
	return v === undefined ? def : v === "true" || v === "1" || v === "yes" || v === "on";
}
function intEnv(name: string, def: number): number {
	const n = Number.parseInt(env(name) ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : def;
}
