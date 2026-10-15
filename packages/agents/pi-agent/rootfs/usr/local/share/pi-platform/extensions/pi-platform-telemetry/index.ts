import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

declare const process: { env: Record<string, string | undefined> };

type Attributes = Record<string, string | number>;

type OtlpAttribute = { key: string; value: { stringValue: string } };

const SCOPE = "pi-platform-telemetry";
const EXPORT_TIMEOUT_MS = 5000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Pi exports no telemetry of its own, so this extension writes one OTLP log record per model call, with the token and cost attributes the platform reads from Claude Code's records, under the event name pi.api_request. Each user prompt also gets a pi.user_prompt record and a prompt.id that the call records carry, which is how the platform groups records into Turns. Prompt text and replies are never exported.
 */
export default function register(pi: ExtensionAPI): void {
	const url = logsUrl();
	if (!url) return;
	const emit = exporter(url, toOtlp(resourceAttributes()));
	let promptId: string | undefined;
	let requestStartedAt: number | undefined;

	pi.on("before_agent_start", (event, ctx) => {
		promptId = crypto.randomUUID();
		emit("user_prompt", {
			"session.id": ctx.sessionManager.getSessionId(),
			"prompt.id": promptId,
			prompt_length: event.prompt.length,
		});
	});

	pi.on("before_provider_request", () => {
		requestStartedAt = Date.now();
	});

	pi.on("message_end", (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		const { usage } = message;
		const startedAt = requestStartedAt;
		requestStartedAt = undefined;
		if (usage.totalTokens === 0 && usage.cost.total === 0) return;
		emit("api_request", {
			"session.id": ctx.sessionManager.getSessionId(),
			...(promptId ? { "prompt.id": promptId } : {}),
			...(message.responseId ? { request_id: message.responseId } : {}),
			model: message.model,
			provider: message.provider,
			input_tokens: usage.input,
			output_tokens: usage.output,
			cache_read_tokens: usage.cacheRead,
			cache_creation_tokens: usage.cacheWrite,
			cost_usd: usage.cost.total,
			cost_usd_micros: Math.round(usage.cost.total * 1e6),
			duration_ms: startedAt === undefined ? 0 : Date.now() - startedAt,
		});
	});

	pi.on("session_shutdown", () => emit.flush());
}

function exporter(url: string, resource: OtlpAttribute[]) {
	const pending = new Set<Promise<void>>();
	let warned = false;
	const warn = (reason: string) => {
		if (warned) return;
		warned = true;
		console.warn(`[${SCOPE}] ${url}: ${reason}`);
	};
	const send = (event: string, attributes: Attributes) => {
		const now = Date.now();
		const logRecord = {
			timeUnixNano: `${now}000000`,
			observedTimeUnixNano: `${now}000000`,
			severityNumber: 9,
			severityText: "INFO",
			body: { stringValue: `pi.${event}` },
			attributes: toOtlp({ "event.name": event, "event.timestamp": new Date(now).toISOString(), ...attributes }),
		};
		const body = { resourceLogs: [{ resource: { attributes: resource }, scopeLogs: [{ scope: { name: SCOPE }, logRecords: [logRecord] }] }] };
		const sent = fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
		}).then(
			(res) => {
				if (!res.ok) warn(`HTTP ${res.status} ${res.statusText}`);
			},
			(err: unknown) => warn(err instanceof Error ? err.message : String(err)),
		);
		pending.add(sent);
		void sent.finally(() => pending.delete(sent));
	};
	return Object.assign(send, { flush: async () => void (await Promise.all(pending)) });
}

function logsUrl(): string | undefined {
	if (env("OTEL_LOGS_EXPORTER") !== "otlp") return undefined;
	const logs = env("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT");
	if (logs) return logs;
	const base = env("OTEL_EXPORTER_OTLP_ENDPOINT")?.replace(/\/+$/, "");
	return base ? `${base}/v1/logs` : undefined;
}

function resourceAttributes(): Attributes {
	const attributes: Attributes = {};
	for (const pair of (env("OTEL_RESOURCE_ATTRIBUTES") ?? "").split(",")) {
		const at = pair.indexOf("=");
		if (at <= 0) continue;
		attributes[pair.slice(0, at).trim()] = decoded(pair.slice(at + 1).trim());
	}
	attributes["service.name"] = env("OTEL_SERVICE_NAME") ?? "pi";
	return attributes;
}

function decoded(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function toOtlp(attributes: Attributes): OtlpAttribute[] {
	return Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: String(value) } }));
}

function env(name: string): string | undefined {
	const v = process.env[name]?.trim();
	return v ? v : undefined;
}
