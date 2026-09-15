import type { LogAttachment, TimelineSpan } from "api-server-api";

export interface UnattachedLog {
  at: string;
  spanId: string;
  traceId: string;
  event: string;
  severity: string;
  service: string;
  agentId: string;
  invocationId: string | null;
  attributes: Record<string, string>;
}

export interface AttachedLog extends UnattachedLog {
  attachedTo: string | null;
  attachedBy: LogAttachment;
}

const REQUEST_KEYS = ["client_request_id", "request_id"] as const;

function requestKeyOf(attributes: Record<string, string>): string | null {
  for (const key of REQUEST_KEYS) {
    const value = attributes[key];
    if (value !== undefined && value !== "") return value;
  }
  return null;
}

export function attachLogsToSpans(
  spans: readonly TimelineSpan[],
  logs: readonly UnattachedLog[],
): AttachedLog[] {
  const spanIds = new Set(spans.map((s) => s.spanId));
  const byRequestKey = new Map<string, string>();
  for (const span of spans) {
    const key = requestKeyOf(span.attributes);
    if (key !== null && !byRequestKey.has(key))
      byRequestKey.set(key, span.spanId);
  }

  return logs.map((log) => {
    const key = requestKeyOf(log.attributes);
    const byRequest = key === null ? undefined : byRequestKey.get(key);
    if (byRequest !== undefined) {
      return {
        ...log,
        attachedTo: byRequest,
        attachedBy: "request-id" as const,
      };
    }
    if (log.spanId !== "" && spanIds.has(log.spanId)) {
      return { ...log, attachedTo: log.spanId, attachedBy: "span-id" as const };
    }
    return { ...log, attachedTo: null, attachedBy: "trace-root" as const };
  });
}
