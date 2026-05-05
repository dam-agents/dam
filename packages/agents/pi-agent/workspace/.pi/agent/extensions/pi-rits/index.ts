import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {ExtensionAPI, ProviderConfig} from "@mariozechner/pi-coding-agent";

declare const process: { env: Record<string, string | undefined> };

export default function register(pi: ExtensionAPI): void {
	const url = env("RITS_URL")?.replace(/\/+$/, "");
	const model = env("RITS_MODEL");
	if (!url || !model) return;

	const provider: ProviderConfig = {
		baseUrl: /\/v\d+$/.test(url) ? url : `${url}/v1`,
		api: "openai-completions",
		// Auth is injected on the wire by the Envoy sidecar's credential_injector
		// filter; the key set here only exists to satisfy pi-acp's per-session
		// auth gate (reads models.json.apiKey).
		apiKey: "dummy-placeholder",
		authHeader: false,
		models: [
			{
				id: model,
				name: model,
				input: ["text"] as const,
				reasoning: boolEnv("RITS_REASONING", false),
				contextWindow: intEnv("RITS_CONTEXT_WINDOW", 128000),
				maxTokens: intEnv("RITS_MAX_TOKENS", 16384),
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				compat: {
					// vLLM (what RITS runs) doesn't speak these.
					supportsDeveloperRole: false,
					supportsReasoningEffort: true,
					supportsUsageInStreaming: false,
					maxTokensField: "max_tokens",
					requiresThinkingAsText: boolEnv("RITS_THINKING_AS_TEXT", false),
					thinkingFormat: env("RITS_THINKING_FORMAT") as any,
				},
			},
		],
	}

	pi.registerProvider("rits", provider);

	// pi-acp re-checks auth against ~/.pi/agent/models.json on every session/prompt.
	// Runtime registerProvider() is invisible to that check, so mirror to disk.
	// Upstream: https://github.com/svkozak/pi-acp/issues/15
	const dir = join(homedir(), ".pi", "agent");
	mkdirSync(dir, { recursive: true });
	const modelsPath = join(dir, "models.json");
	let modelsFile: { providers: Record<string, ProviderConfig> } = { providers: {} };
	try {
		const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as { providers?: Record<string, ProviderConfig> };
		if (parsed && typeof parsed === "object" && parsed.providers) {
			modelsFile = { providers: parsed.providers };
		}
	} catch {
		// models.json may not exist yet on a fresh home; start from empty.
	}
	modelsFile.providers.rits = provider;
	writeFileSync(modelsPath, `${JSON.stringify(modelsFile, null, 2)}\n`);

	// Pi reads defaults from settings.json on each session start, so patching the
	// file here makes RITS the default for subsequent sessions without losing any
	// other settings already configured in the workspace.
	const settingsPath = join(dir, "settings.json");
	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
	} catch {
		// settings.json may not exist yet on a fresh home; start from empty.
	}
	settings.defaultProvider = "rits";
	settings.defaultModel = model;
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
