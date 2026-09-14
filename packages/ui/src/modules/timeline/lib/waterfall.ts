import type { TimelineLog, TimelineSpan, TurnDetail } from "api-server-api";

export interface WaterfallSpan {
  span: TimelineSpan;
  depth: number;
  offsetPct: number;
  widthPct: number;
  logs: TimelineLog[];
}

export interface Waterfall {
  rows: WaterfallSpan[];
  looseLogs: TimelineLog[];
  startMs: number;
  totalMs: number;
}

const startOf = (iso: string): number => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
};

export function spanKindLabel(name: string): string {
  const short = name.startsWith("claude_code.") ? name.slice(12) : name;
  return short === "" ? name : short;
}

export function buildWaterfall(trace: TurnDetail): Waterfall {
  const spans = [...trace.spans].sort(
    (a, b) => startOf(a.startedAt) - startOf(b.startedAt),
  );

  const byParent = new Map<string, TimelineSpan[]>();
  const known = new Set(spans.map((s) => s.spanId));
  for (const span of spans) {
    const parent = known.has(span.parentSpanId) ? span.parentSpanId : "";
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(span);
    else byParent.set(parent, [span]);
  }

  const logsBySpan = new Map<string, TimelineLog[]>();
  const looseLogs: TimelineLog[] = [];
  for (const log of trace.logs) {
    if (log.attachedTo === null || !known.has(log.attachedTo)) {
      looseLogs.push(log);
      continue;
    }
    const bucket = logsBySpan.get(log.attachedTo);
    if (bucket) bucket.push(log);
    else logsBySpan.set(log.attachedTo, [log]);
  }

  const starts = spans.map((s) => startOf(s.startedAt));
  const ends = spans.map((s) => startOf(s.startedAt) + s.durationMs);
  const logTimes = trace.logs.map((l) => startOf(l.at));
  const startMs = Math.min(...starts, ...logTimes, Number.POSITIVE_INFINITY);
  const endMs = Math.max(...ends, ...logTimes, Number.NEGATIVE_INFINITY);
  const base = Number.isFinite(startMs) ? startMs : 0;
  const totalMs = Number.isFinite(endMs) && endMs > base ? endMs - base : 1;

  const rows: WaterfallSpan[] = [];
  const walk = (parent: string, depth: number): void => {
    for (const span of byParent.get(parent) ?? []) {
      const from = startOf(span.startedAt) - base;
      rows.push({
        span,
        depth,
        offsetPct: Math.max(0, Math.min(100, (from / totalMs) * 100)),
        widthPct: Math.max(
          0.4,
          Math.min(100, (span.durationMs / totalMs) * 100),
        ),
        logs: (logsBySpan.get(span.spanId) ?? []).sort(
          (a, b) => startOf(a.at) - startOf(b.at),
        ),
      });
      walk(span.spanId, depth + 1);
    }
  };
  walk("", 0);

  return {
    rows,
    looseLogs: looseLogs.sort((a, b) => startOf(a.at) - startOf(b.at)),
    startMs: base,
    totalMs,
  };
}

export function logOffsetPct(
  log: TimelineLog,
  startMs: number,
  totalMs: number,
): number {
  const at = startOf(log.at) - startMs;
  return Math.max(0, Math.min(100, (at / totalMs) * 100));
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
