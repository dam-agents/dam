import type { TelemetrySpan, TurnGrouping } from "api-server-api";

import type { UnattachedLog } from "./attach-logs.js";

export const PROMPT_ID_ATTRIBUTE = "prompt.id";
export const TURN_BOUNDARY_EVENT = "claude_code.user_prompt";
export const LEADING_GAP_MS = 60_000;
export const BOUNDARY_DEBOUNCE_MS = 2_000;
const CALL_EVENT = "claude_code.api_request";
const ERROR_EVENT = "claude_code.api_error";

export interface TurnGroup {
  turnId: string;
  promptId: string | null;
  groupedBy: TurnGrouping;
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

const logItem = (log: UnattachedLog): Item => ({
  ms: at(log.at),
  endMs: at(log.at),
  log,
});

const spanItem = (span: TelemetrySpan): Item => ({
  ms: at(span.startedAt),
  endMs: at(span.startedAt) + span.durationMs,
  span,
});

export function promptIdOf(log: UnattachedLog): string | null {
  const id = log.attributes[PROMPT_ID_ATTRIBUTE];
  return id === undefined || id === "" ? null : id;
}

interface Identity {
  promptId: string | null;
  groupedBy: TurnGrouping;
}

function summarise(items: readonly Item[], identity: Identity): TurnGroup {
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
    turnId: identity.promptId ?? startedAt,
    promptId: identity.promptId,
    groupedBy: identity.groupedBy,
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
      ...new Set(
        [...logs.map((l) => l.traceId), ...spans.map((s) => s.traceId)].filter(
          (id) => id !== "",
        ),
      ),
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

interface KeyedTurn {
  promptId: string;
  items: Item[];
  startMs: number;
  endMs: number;
  traceIds: Set<string>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a keyed turn is every record the harness stamped
 * with one prompt id — the identifier it assigns a prompt and carries onto all
 * the events that prompt causes until the next one. Records without the stamp
 * are left for the time grouping below; they are the session's housekeeping and
 * whatever an older harness emitted.
 */
function keyedTurnsOf(logs: readonly UnattachedLog[]): {
  keyed: KeyedTurn[];
  loose: UnattachedLog[];
} {
  const byPrompt = new Map<string, KeyedTurn>();
  const loose: UnattachedLog[] = [];
  for (const log of logs) {
    const promptId = promptIdOf(log);
    if (promptId === null) {
      loose.push(log);
      continue;
    }
    const item = logItem(log);
    const turn = byPrompt.get(promptId);
    if (turn === undefined) {
      byPrompt.set(promptId, {
        promptId,
        items: [item],
        startMs: item.ms,
        endMs: item.endMs,
        traceIds: new Set(log.traceId === "" ? [] : [log.traceId]),
      });
      continue;
    }
    turn.items.push(item);
    turn.startMs = Math.min(turn.startMs, item.ms);
    turn.endMs = Math.max(turn.endMs, item.endMs);
    if (log.traceId !== "") turn.traceIds.add(log.traceId);
  }
  return {
    keyed: [...byPrompt.values()].sort((a, b) => a.startMs - b.startMs),
    loose,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: spans carry no prompt id, so a span joins the
 * keyed turn whose records share its trace, or — the records of a turn
 * sometimes carry no trace at all while its span has one of its own — the turn
 * whose records surround its start. The surrounding window is padded by the
 * marker slack because a turn's root span opens a few milliseconds before the
 * prompt record that names the turn. A span no keyed turn accounts for is
 * returned for the time grouping.
 */
function attachSpans(
  keyed: readonly KeyedTurn[],
  spans: readonly TelemetrySpan[],
): TelemetrySpan[] {
  const loose: TelemetrySpan[] = [];
  for (const span of spans) {
    const ms = at(span.startedAt);
    const byTrace =
      span.traceId === ""
        ? undefined
        : keyed.find((k) => k.traceIds.has(span.traceId));
    const owner =
      byTrace ??
      keyed
        .filter(
          (k) =>
            k.startMs - BOUNDARY_DEBOUNCE_MS <= ms &&
            ms <= k.endMs + BOUNDARY_DEBOUNCE_MS,
        )
        .at(-1);
    if (owner === undefined) loose.push(span);
    else owner.items.push(spanItem(span));
  }
  return loose;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: without a prompt id, an exchange begins either
 * where the harness says so with a prompt record, or where it opens a
 * parentless span — a root span is new top-level work by definition, and it is
 * the only marker a turn gets when the harness emits spans and no records at
 * all. The two markers fire within milliseconds of each other when both are
 * present, so a debounce keeps one exchange from reading as two.
 */
function marksTurnStart(item: Item): boolean {
  if (item.log?.event === TURN_BOUNDARY_EVENT) return true;
  return item.span !== undefined && item.span.parentSpanId === "";
}

function groupByTime(
  logs: readonly UnattachedLog[],
  spans: readonly TelemetrySpan[],
): Item[][] {
  const items: Item[] = [...logs.map(logItem), ...spans.map(spanItem)].sort(
    (a, b) => a.ms - b.ms,
  );

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

  return groups;
}

export function groupIntoTurns(
  logs: readonly UnattachedLog[],
  spans: readonly TelemetrySpan[],
): TurnGroup[] {
  const { keyed, loose } = keyedTurnsOf(logs);
  const looseSpans = attachSpans(keyed, spans);
  const groups = [
    ...keyed.map((k) =>
      summarise(k.items, { promptId: k.promptId, groupedBy: "prompt-id" }),
    ),
    ...groupByTime(loose, looseSpans).map((items) =>
      summarise(items, { promptId: null, groupedBy: "time" }),
    ),
  ];
  return groups.sort((a, b) => at(a.startedAt) - at(b.startedAt));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an Invocation target's whole run read as one turn
 * — the target answers a single prompt, so the sum over every record and span
 * it produced is the number its card shows, whatever prompt ids it stamped.
 */
export function summariseRun(
  turnId: string,
  logs: readonly UnattachedLog[],
  spans: readonly TelemetrySpan[],
): TurnGroup | null {
  const items = [...logs.map(logItem), ...spans.map(spanItem)];
  if (items.length === 0) return null;
  return {
    ...summarise(items, { promptId: null, groupedBy: "time" }),
    turnId,
  };
}
