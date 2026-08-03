import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

declare const process: { env: Record<string, string | undefined> };

// A spec activates when ${envPrefix}_URL is set. Models come from the
// OpenAI-compatible /v1/models endpoint; ${envPrefix}_MODEL only picks the
// default. If discovery fails we register the single ${envPrefix}_MODEL, else
// skip the spec. Auth is injected on the wire by Envoy's credential_injector;
// the apiKey here only satisfies pi-acp's auth gate, and discovery deliberately
// omits Authorization so Envoy injects it the same way.

type ProviderSpec = {
	name: string;
	envPrefix: string;
	// When activated and ${envPrefix}_URL matches the shadow's urlEnv, hide the
	// named provider as a duplicate alias. apiKeyEnv is unset so built-in
	// providers (auth discovered via pi-ai env-api-keys) drop out of
	// getAvailable() — unregisterProvider() only affects dynamic ones.
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

	// Default to the requested model only if it was discovered (matched
	// case-insensitively; proxies are inconsistent), preferring the discovered
	// casing so it matches upstream. Otherwise use the first discovered model.
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
	// Cap maxTokens at the context window (vLLM's max_model_len covers input+output).
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
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			supportsUsageInStreaming: false,
			maxTokensField: "max_tokens",
			requiresThinkingAsText: boolEnv(`${envPrefix}_THINKING_AS_TEXT`, false),
			thinkingFormat: env(`${envPrefix}_THINKING_FORMAT`) as any,
		},
	};
}

// Best-effort: startup may race the upstream, the endpoint may be missing, or
// the response malformed. The caller falls back to env-defined registration; we
// warn so operators see when discovery silently degrades.
async function discoverModels(url: string): Promise<DiscoveredModel[]> {
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
	// pi-acp re-checks models.json/auth.json every session/prompt and can't see
	// runtime registerProvider(), so mirror to disk.
	// Upstream: https://github.com/svkozak/pi-acp/issues/15
	writeJson(state.paths.models, state.models);
	writeJson(state.paths.auth, state.auth);

	// Keep the user's existing default if it still resolves to a registered
	// model; only fall back to the last-activated spec otherwise.
	const chosen = resolveExistingDefault(state) ?? lastActivated;
	state.settings.defaultProvider = chosen.name;
	state.settings.defaultModel = chosen.model;
	writeJson(state.paths.settings, state.settings);
}

// Resolve the configured default to a still-registered provider/model,
// preferring the user's own provider and matching ids case-insensitively.
// Returns the registered casing, or undefined when there's no usable default.
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
		const hit = state.models.providers[name]?.models?.find((m) => m.id.toLowerCase() === wanted);
		if (hit) return { name, model: hit.id };
	}
	return undefined;
}

function readJson<T>(path: string): T | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as T) : undefined;
	} catch {
		// Missing on a fresh home or malformed; caller treats undefined as empty.
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
