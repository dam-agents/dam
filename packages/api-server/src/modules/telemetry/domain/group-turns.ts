import type { TelemetrySpan } from "api-server-api";

import type { UnattachedLog } from "./attach-logs.js";

export const TURN_BOUNDARY_EVENT = "claude_code.user_prompt";
export const LEADING_GAP_MS = 60_000;
export const BOUNDARY_DEBOUNCE_MS = 2_000;
const CALL_EVENT = "claude_code.api_request";
const ERROR_EVENT = "claude_code.api_error";

export interface TurnGroup {
  turnId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  prompted: boolean;
  spanCount: number;
  recordCount: number;
  errorCount: number;
  traceIds: string[];
  rootName: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  models: string[];
}

const at = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
};

const num = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") return 0;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
};

interface Item {
  ms: number;
  endMs: number;
  span?: TelemetrySpan;
  log?: UnattachedLog;
}

function summarise(items: readonly Item[]): TurnGroup {
  const spans = items.flatMap((i) => (i.span ? [i.span] : []));
  const logs = items.flatMap((i) => (i.log ? [i.log] : []));
  const calls = logs.filter((l) => l.event === CALL_EVENT);

  const startedMs = Math.min(...items.map((i) => i.ms));
  const endedMs = Math.max(...items.map((i) => i.endMs));
  const startedAt = new Date(startedMs).toISOString();

  const root = spans.find((s) => s.parentSpanId === "");
  const models = [
    ...new Set(
      calls.flatMap((c) => (c.attributes.model ? [c.attributes.model] : [])),
    ),
  ];

  return {
    turnId: startedAt,
    startedAt,
    endedAt: new Date(endedMs).toISOString(),
    durationMs: Math.max(0, endedMs - startedMs),
    prompted: logs.some((l) => l.event === TURN_BOUNDARY_EVENT),
    spanCount: spans.length,
    recordCount: logs.length,
    errorCount:
      spans.filter((s) => s.statusCode.includes("ERROR")).length +
      logs.filter((l) => l.event === ERROR_EVENT).length,
    traceIds: [
      ...new Set([...logs.map((l) => l.traceId)].filter((id) => id !== "")),
    ],
    rootName: root?.name ?? spans[0]?.name ?? "",
    calls: calls.length,
    costUsd: calls.reduce(
      (sum, c) => sum + num(c.attributes.cost_usd_micros) / 1e6,
      0,
    ),
    inputTokens: calls.reduce((s, c) => s + num(c.attributes.input_tokens), 0),
    outputTokens: calls.reduce(
      (s, c) => s + num(c.attributes.output_tokens),
      0,
    ),
    cacheReadTokens: calls.reduce(
      (s, c) => s + num(c.attributes.cache_read_tokens),
      0,
    ),
    cacheCreationTokens: calls.reduce(
      (s, c) => s + num(c.attributes.cache_creation_tokens),
      0,
    ),
    models,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an exchange begins either where the harness says so
 * with a prompt record, or where it opens a parentless span — a root span is new
 * top-level work by definition, and it is the only marker a turn gets when the
 * harness emits spans and no records at all. The two markers fire within
 * milliseconds of each other when both are present, so a debounce keeps one
 * exchange from reading as two.
 */
function marksTurnStart(item: Item): boolean {
  if (item.log?.event === TURN_BOUNDARY_EVENT) return true;
  return item.span !== undefined && item.span.parentSpanId === "";
}

export function groupIntoTurns(
  logs: readonly UnattachedLog[],
  spans: readonly TelemetrySpan[],
): TurnGroup[] {
  const items: Item[] = [
    ...logs.map((log) => ({ ms: at(log.at), endMs: at(log.at), log })),
    ...spans.map((span) => ({
      ms: at(span.startedAt),
      endMs: at(span.startedAt) + span.durationMs,
      span,
    })),
  ].sort((a, b) => a.ms - b.ms);

  if (items.length === 0) return [];

  const firstMarked = items.findIndex(marksTurnStart);
  const unmarkedEnd = firstMarked === -1 ? items.length : firstMarked;

  const groups: Item[][] = [];
  let current: Item[] = [];
  let openedAt = 0;
  for (const [index, item] of items.entries()) {
    const previous = current.at(-1);
    const marked =
      marksTurnStart(item) && item.ms - openedAt >= BOUNDARY_DEBOUNCE_MS;
    const idleSplit =
      index < unmarkedEnd &&
      previous !== undefined &&
      item.ms - previous.endMs >= LEADING_GAP_MS;
    if ((marked || idleSplit) && current.length > 0) {
      groups.push(current);
      current = [];
    }
    if (current.length === 0) openedAt = item.ms;
    current.push(item);
  }
  if (current.length > 0) groups.push(current);

  return groups.map(summarise);
}
