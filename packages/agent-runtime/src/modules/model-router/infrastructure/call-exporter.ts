import type { RuntimeEnvState } from "../../runtime-channel/infrastructure/env-state-store.js";
import type { ModelCallRecord } from "../services/model-router.js";

export const MODEL_CALL_BODY = "platform.model_call";

export interface OtlpTarget {
  url: string;
  headers: Record<string, string>;
  resource: Record<string, string>;
}

const decoded = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const pairs = (raw: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (raw ?? "")
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf("=");
        return at === -1
          ? [pair, ""]
          : [pair.slice(0, at).trim(), decoded(pair.slice(at + 1).trim())];
      }),
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: the OTLP endpoint of the export rail the install
 * delivered to this pod, read from whichever env layer carries it. Null when
 * no rail reached the pod, in which case nothing is exported.
 */
export function otlpTargetOf(state: RuntimeEnvState): OtlpTarget | null {
  const layers = [state.env, ...state.harnesses.map((l) => l.env)];
  const env = layers.find(
    (e) => e.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || e.OTEL_EXPORTER_OTLP_ENDPOINT,
  );
  if (!env) return null;
  const url =
    env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    `${env.OTEL_EXPORTER_OTLP_ENDPOINT!.replace(/\/+$/, "")}/v1/logs`;
  return {
    url,
    headers: {
      ...pairs(env.OTEL_EXPORTER_OTLP_HEADERS),
      ...pairs(env.OTEL_EXPORTER_OTLP_LOGS_HEADERS),
    },
    resource: {
      "service.name": "platform-model-router",
      ...pairs(env.OTEL_RESOURCE_ATTRIBUTES),
    },
  };
}

const str = (value: string | number | boolean) => ({
  stringValue: String(value),
});
const attrs = (record: Record<string, string | number | boolean | null>) =>
  Object.entries(record).flatMap(([key, value]) =>
    value === null ? [] : [{ key, value: str(value) }],
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: the attributes carry the counters under the
 * names the spend reader already reads from Claude Code's records, plus the
 * platform's own; the trace context is the harness's, so the record sits in
 * the session's trace.
 */
export function otlpLogRecord(
  record: ModelCallRecord,
): Record<string, unknown> {
  const usage = record.usage;
  return {
    timeUnixNano: `${BigInt(Date.parse(record.startedAt)) * 1_000_000n}`,
    severityNumber: 9,
    severityText: "INFO",
    body: str(MODEL_CALL_BODY),
    ...(record.trace && {
      traceId: record.trace.traceId,
      spanId: record.trace.spanId,
    }),
    attributes: attrs({
      "session.id": record.session ?? "",
      model: `${record.alias}/${record.upstreamId}`,
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
      cache_read_tokens: usage?.cacheReadTokens ?? 0,
      cache_creation_tokens: usage?.cacheCreationTokens ?? 0,
      duration_ms: record.durationMs,
      request_id: record.requestId ?? "",
      "platform.model.router": true,
      "platform.connection.id": record.connectionId,
      "platform.provider.alias": record.alias,
      "platform.model.upstream": record.upstreamId,
      "platform.model.requested": record.requestedModel,
      "platform.harness": record.harness,
      "platform.dialect": record.dialect,
      "platform.status": record.status,
      "platform.stream": record.stream,
      "platform.uncounted": record.uncounted ?? "",
    }),
  };
}

export function otlpLogsPayload(
  target: OtlpTarget,
  records: readonly ModelCallRecord[],
): Record<string, unknown> {
  return {
    resourceLogs: [
      {
        resource: { attributes: attrs(target.resource) },
        scopeLogs: [
          {
            scope: { name: "platform-model-router" },
            logRecords: records.map(otlpLogRecord),
          },
        ],
      },
    ],
  };
}

export interface ModelCallExporter {
  record(record: ModelCallRecord): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: call records are posted through the global
 * fetch, which honours the agent's proxy so the gateway stamps the
 * attribution. A failed post is retried once with the next batch, then
 * dropped: spend is best-effort telemetry, never a reason to hold a call.
 */
export function createModelCallExporter(deps: {
  envState: () => RuntimeEnvState;
  fetchImpl?: typeof globalThis.fetch;
  log: (msg: string) => void;
  flushMs?: number;
  maxBatch?: number;
}): ModelCallExporter {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const flushMs = deps.flushMs ?? 1000;
  const maxBatch = deps.maxBatch ?? 100;
  let queue: ModelCallRecord[] = [];
  let retrying: ModelCallRecord[] = [];
  let timer: NodeJS.Timeout | null = null;
  let inflight: Promise<void> = Promise.resolve();
  let stopped = false;
  const retriedOnce = new WeakSet<ModelCallRecord>();

  const post = async (
    target: OtlpTarget,
    batch: ModelCallRecord[],
  ): Promise<boolean> => {
    try {
      const res = await doFetch(target.url, {
        method: "POST",
        headers: { ...target.headers, "content-type": "application/json" },
        body: JSON.stringify(otlpLogsPayload(target, batch)),
      });
      if (res.ok) return true;
      deps.log(
        `[model-router] spend export refused by ${target.url}: HTTP ${res.status}`,
      );
    } catch (err) {
      deps.log(
        `[model-router] spend export to ${target.url} failed: ${(err as Error).message}`,
      );
    }
    return false;
  };

  const send = async (): Promise<void> => {
    const batch = [...retrying, ...queue];
    queue = [];
    retrying = [];
    if (batch.length === 0) return;
    const target = otlpTargetOf(deps.envState());
    if (!target) return;
    if (await post(target, batch)) return;
    const fresh = batch.filter((r) => !retriedOnce.has(r));
    for (const r of fresh) retriedOnce.add(r);
    retrying = fresh;
    const dropped = batch.length - fresh.length;
    if (dropped > 0)
      deps.log(
        `[model-router] dropped ${dropped} spend record(s) after a failed retry`,
      );
  };

  const sendNext = (): Promise<void> => {
    inflight = inflight.then(send).catch((err: Error) => {
      deps.log(`[model-router] spend export failed: ${err.message}`);
    });
    return inflight;
  };

  const schedule = (): void => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void sendNext();
    }, flushMs);
    timer.unref();
  };

  return {
    record(record) {
      if (stopped) return;
      queue.push(record);
      if (queue.length >= maxBatch) {
        if (timer) clearTimeout(timer);
        timer = null;
        void sendNext();
        return;
      }
      schedule();
    },
    async flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      await sendNext();
    },
    async stop() {
      stopped = true;
      await this.flush();
    },
  };
}
