import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderConfig } from "@mariozechner/pi-coding-agent";

declare const process: { env: Record<string, string | undefined> };

// Each spec is activated only when ${envPrefix}_URL and ${envPrefix}_MODEL are
// set on the pod. Auth is injected on the wire by the Envoy sidecar's
// credential_injector filter (ADR-033); the apiKey here only exists to satisfy
// pi-acp's per-session auth gate (reads models.json.apiKey + auth.json).

type ProviderSpec = {
	name: string;
	envPrefix: string;
};

const SPECS: ProviderSpec[] = [
	{ name: "rits", envPrefix: "RITS" },
	{ name: "openai-proxy", envPrefix: "OPENAI_PROXY" },
];

export default function register(pi: ExtensionAPI): void {
	const dir = join(homedir(), ".pi", "agent");
	mkdirSync(dir, { recursive: true });
	const modelsPath = join(dir, "models.json");
	const authPath = join(dir, "auth.json");
	const settingsPath = join(dir, "settings.json");

	let modelsFile: { providers: Record<string, ProviderConfig> } = { providers: {} };
	try {
		const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as { providers?: Record<string, ProviderConfig> };
		if (parsed && typeof parsed === "object" && parsed.providers) {
			modelsFile = { providers: parsed.providers };
		}
	} catch {
		// models.json may not exist yet on a fresh home; start from empty.
	}

	let authFile: Record<string, { type: string; key: string }> = {};
	try {
		const parsed = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, { type: string; key: string }>;
		if (parsed && typeof parsed === "object") {
			authFile = parsed;
		}
	} catch {
		// auth.json may not exist yet on a fresh home; start from empty.
	}

	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
	} catch {
		// settings.json may not exist yet on a fresh home; start from empty.
	}

	let lastActivated: { name: string; model: string } | undefined;

	for (const spec of SPECS) {
		const url = env(`${spec.envPrefix}_URL`)?.replace(/\/+$/, "");
		const model = env(`${spec.envPrefix}_MODEL`);
		if (!url || !model) continue;

		const apiKey = env(`${spec.envPrefix}_API_KEY`) ?? "dummy-placeholder";
		const provider: ProviderConfig = {
			baseUrl: /\/v\d+$/.test(url) ? url : `${url}/v1`,
			api: "openai-completions",
			apiKey,
			authHeader: false,
			models: [
				{
					id: model,
					name: model,
					input: ["text"] as const,
					reasoning: boolEnv(`${spec.envPrefix}_REASONING`, false),
					contextWindow: intEnv(`${spec.envPrefix}_CONTEXT_WINDOW`, 128000),
					maxTokens: intEnv(`${spec.envPrefix}_MAX_TOKENS`, 16384),
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					compat: {
						// vLLM and most OpenAI-compatible proxies don't speak these.
						supportsDeveloperRole: false,
						supportsReasoningEffort: true,
						supportsUsageInStreaming: false,
						maxTokensField: "max_tokens",
						requiresThinkingAsText: boolEnv(`${spec.envPrefix}_THINKING_AS_TEXT`, false),
						thinkingFormat: env(`${spec.envPrefix}_THINKING_FORMAT`) as any,
					},
				},
			],
		};

		pi.registerProvider(spec.name, provider);
		modelsFile.providers[spec.name] = provider;
		authFile[spec.name] = { type: "api_key", key: apiKey };
		lastActivated = { name: spec.name, model };
	}

	if (!lastActivated) return;

	// pi-acp re-checks models.json/auth.json on every session/prompt; runtime
	// registerProvider() is invisible to that check, so mirror to disk.
	// Upstream: https://github.com/svkozak/pi-acp/issues/15
	writeFileSync(modelsPath, `${JSON.stringify(modelsFile, null, 2)}\n`);
	writeFileSync(authPath, `${JSON.stringify(authFile, null, 2)}\n`);

	// Make the last-activated provider the session default without losing any
	// other settings already configured in the workspace.
	settings.defaultProvider = lastActivated.name;
	settings.defaultModel = lastActivated.model;
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
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
