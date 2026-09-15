import type { TimelineLog, TimelineSpan, TurnDetail } from "api-server-api";

export interface SpanRow {
  kind: "span";
  key: string;
  span: TimelineSpan;
  depth: number;
  offsetPct: number;
  widthPct: number;
  logs: TimelineLog[];
}

export interface LogRow {
  kind: "log";
  key: string;
  log: TimelineLog;
  offsetPct: number;
}

export type TimelineRow = SpanRow | LogRow;

export interface Waterfall {
  rows: TimelineRow[];
  startMs: number;
  totalMs: number;
  traceCount: number;
}

const startOf = (iso: string): number => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

export function spanKindLabel(name: string): string {
  const short = name.startsWith("claude_code.") ? name.slice(12) : name;
  return short === "" ? name : short;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the time axis is the substrate and the span tree
 * is an enrichment on top of it, so a record with no trace and a span with a
 * trace of its own are both placed rather than one of them being set aside.
 */
export function buildWaterfall(turn: TurnDetail): Waterfall {
  const spans = [...turn.spans].sort(
    (a, b) => startOf(a.startedAt) - startOf(b.startedAt),
  );
  const known = new Set(spans.map((s) => s.spanId));

  const byParent = new Map<string, TimelineSpan[]>();
  for (const span of spans) {
    const parent = known.has(span.parentSpanId) ? span.parentSpanId : "";
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(span);
    else byParent.set(parent, [span]);
  }

  const logsBySpan = new Map<string, TimelineLog[]>();
  const looseLogs: TimelineLog[] = [];
  for (const log of turn.logs) {
    if (log.attachedTo !== null && known.has(log.attachedTo)) {
      const bucket = logsBySpan.get(log.attachedTo);
      if (bucket) bucket.push(log);
      else logsBySpan.set(log.attachedTo, [log]);
    } else {
      looseLogs.push(log);
    }
  }

  const marks = [
    ...spans.map((s) => startOf(s.startedAt)),
    ...spans.map((s) => startOf(s.startedAt) + s.durationMs),
    ...turn.logs.map((l) => startOf(l.at)),
  ].filter((n) => n > 0);
  const startMs = marks.length > 0 ? Math.min(...marks) : 0;
  const endMs = marks.length > 0 ? Math.max(...marks) : 0;
  const totalMs = endMs > startMs ? endMs - startMs : 1;

  const pct = (ms: number): number =>
    Math.max(0, Math.min(100, ((ms - startMs) / totalMs) * 100));

  const spanRows: SpanRow[] = [];
  const walk = (parent: string, depth: number): void => {
    for (const span of byParent.get(parent) ?? []) {
      const from = startOf(span.startedAt);
      spanRows.push({
        kind: "span",
        key: `span:${span.spanId}`,
        span,
        depth,
        offsetPct: pct(from),
        widthPct: Math.max(
          0.5,
          Math.min(100 - pct(from), (span.durationMs / totalMs) * 100),
        ),
        logs: (logsBySpan.get(span.spanId) ?? []).sort(
          (a, b) => startOf(a.at) - startOf(b.at),
        ),
      });
      walk(span.spanId, depth + 1);
    }
  };
  walk("", 0);

  const logRows: LogRow[] = looseLogs.map((log, i) => ({
    kind: "log",
    key: `log:${log.at}:${log.event}:${i}`,
    log,
    offsetPct: pct(startOf(log.at)),
  }));

  const rowTime = (row: TimelineRow): number =>
    row.kind === "span" ? startOf(row.span.startedAt) : startOf(row.log.at);

  const topLevel: TimelineRow[] = [];
  const nested = new Map<string, SpanRow[]>();
  for (const row of spanRows) {
    if (row.depth === 0) topLevel.push(row);
    else {
      const owner = row.span.parentSpanId;
      const bucket = nested.get(owner);
      if (bucket) bucket.push(row);
      else nested.set(owner, [row]);
    }
  }

  const ordered: TimelineRow[] = [...topLevel, ...logRows].sort(
    (a, b) => rowTime(a) - rowTime(b),
  );

  const withChildren: TimelineRow[] = [];
  const emit = (row: TimelineRow): void => {
    withChildren.push(row);
    if (row.kind !== "span") return;
    for (const child of nested.get(row.span.spanId) ?? []) emit(child);
  };
  for (const row of ordered) emit(row);

  return {
    rows: withChildren,
    startMs,
    totalMs,
    traceCount: new Set(
      turn.logs.map((l) => l.traceId).filter((id) => id !== ""),
    ).size,
  };
}

const COST_KEYS = ["cost_usd_micros"] as const;

export function logCostUsd(log: TimelineLog): number | null {
  for (const key of COST_KEYS) {
    const raw = log.attributes[key];
    if (raw === undefined) continue;
    const micros = Number(raw);
    if (!Number.isNaN(micros)) return micros / 1e6;
  }
  return null;
}

const SUMMARY_KEYS = [
  "model",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "tool_name",
  "decision",
] as const;

export function logSummary(log: TimelineLog): string {
  const parts = SUMMARY_KEYS.flatMap((key) => {
    const value = log.attributes[key];
    return value === undefined || value === "" ? [] : [`${key}=${value}`];
  });
  return parts.join(" · ");
}

export function logEventLabel(event: string): string {
  return event.startsWith("claude_code.") ? event.slice(12) : event;
}

export interface Placement {
  label: string;
  exact: boolean;
}

export function placementOf(log: TimelineLog): Placement {
  switch (log.attachedBy) {
    case "request-id":
      return { label: "matched to this call by its request id", exact: true };
    case "span-id":
      return { label: "matched to the span it was emitted in", exact: true };
    default:
      return {
        label: "placed by its timestamp — no link recorded",
        exact: false,
      };
  }
}
