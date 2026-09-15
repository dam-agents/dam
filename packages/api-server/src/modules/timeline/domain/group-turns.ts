import type { TimelineSpan } from "api-server-api";

import type { UnattachedLog } from "./attach-logs.js";

export const TURN_BOUNDARY_EVENT = "claude_code.user_prompt";
export const LEADING_GAP_MS = 60_000;
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
  span?: TimelineSpan;
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

export function groupIntoTurns(
  logs: readonly UnattachedLog[],
  spans: readonly TimelineSpan[],
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

  const firstPrompt = items.findIndex(
    (i) => i.log?.event === TURN_BOUNDARY_EVENT,
  );
  const leadingEnd = firstPrompt === -1 ? items.length : firstPrompt;

  const groups: Item[][] = [];
  let current: Item[] = [];
  for (const [index, item] of items.entries()) {
    const startsTurn = item.log?.event === TURN_BOUNDARY_EVENT;
    const previous = current.at(-1);
    const idleSplit =
      index < leadingEnd &&
      previous !== undefined &&
      item.ms - previous.endMs >= LEADING_GAP_MS;
    if ((startsTurn || idleSplit) && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) groups.push(current);

  return groups.map(summarise);
}
