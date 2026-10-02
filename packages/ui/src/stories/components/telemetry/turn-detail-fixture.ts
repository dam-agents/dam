/**
 * The telemetry of the first turn of the checkout-service "one-cent rounding"
 * session. The summary is the one the fixture backend's `telemetry.turns`
 * serves; the span/record detail (which the fixture backend does not serve)
 * is derived from the same turn's tool calls in the fixture transcript, so
 * the waterfall lines up with what the chat shows.
 */
import type {
  TelemetryLog,
  TelemetrySpan,
  TurnDetail,
  TurnSummary,
} from "api-server-api";

import { agentHistory } from "../../backend/agent-fixtures";
import { turnsFor } from "../../backend/fixtures/chat";
import { IDS } from "../../backend/scenario";

const AGENT = IDS.codingAgent;
const SESSION = IDS.session1;

export const TURN: TurnSummary = turnsFor(AGENT, SESSION)[0]!;

const TOOL_NAMES: Record<string, string> = {
  search: "Grep",
  read: "Read",
  edit: "Edit",
  execute: "Bash",
};

const iso = (ms: number) => new Date(ms).toISOString();
const hex = (n: number, len: number) => n.toString(16).padStart(len, "0");

function buildTurn(): TurnDetail {
  const traceId = TURN.traceIds[0]!;
  const start = Date.parse(TURN.startedAt);
  const end = Date.parse(TURN.endedAt);
  const frames = (agentHistory(AGENT)[SESSION] ?? []).filter((f) => {
    const at = f.at ? Date.parse(f.at) : Number.NaN;
    return at >= start && at <= end;
  });

  let seq = 0;
  const spanId = () => hex(++seq, 16);
  const rootId = spanId();
  const spans: TelemetrySpan[] = [];
  const logs: TelemetryLog[] = [];
  const base = {
    traceId,
    service: "claude-code",
    agentId: AGENT,
    invocationId: null,
  };
  const span = (
    name: string,
    parent: string,
    from: number,
    to: number,
    attributes: Record<string, string>,
    failed = false,
  ): string => {
    const id = name === "claude_code.interaction" ? rootId : spanId();
    spans.push({
      ...base,
      spanId: id,
      parentSpanId: parent,
      name,
      kind: "SPAN_KIND_INTERNAL",
      startedAt: iso(from),
      durationMs: Math.max(1, to - from),
      statusCode: failed ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
      statusMessage: failed ? "tool exited with a non-zero status" : "",
      attributes,
    });
    return id;
  };
  const log = (
    event: string,
    at: number,
    attachedTo: string | null,
    attachedBy: TelemetryLog["attachedBy"],
    attributes: Record<string, string>,
  ) =>
    logs.push({
      ...base,
      spanId: attachedTo ?? "",
      at: iso(at),
      event,
      severity: "INFO",
      attributes,
      attachedTo,
      attachedBy,
    });

  span("claude_code.interaction", "", start, end, {
    "session.id": SESSION,
    "user_prompt.length": "212",
  });
  log("claude_code.user_prompt", start, null, "trace-root", {
    prompt_length: "212",
  });

  const perCallUsd = TURN.costUsd / Math.max(1, TURN.calls);
  let cursor = start + 800;
  let call = 0;
  const llm = (until: number) => {
    const id = span("claude_code.llm_request", rootId, cursor, until, {
      model: TURN.models[0] ?? "",
      "request.id": `req_${hex(++call, 8)}`,
    });
    log("claude_code.api_request", until, id, "request-id", {
      model: TURN.models[0] ?? "",
      cost_usd_micros: String(Math.round(perCallUsd * 1e6)),
      input_tokens: String(Math.round(TURN.inputTokens / TURN.calls)),
      output_tokens: String(Math.round(TURN.outputTokens / TURN.calls)),
    });
  };

  const started = new Map<string, { at: number; title: string; kind: string }>();
  for (const { update, at } of frames) {
    const t = Date.parse(at!);
    if (update.sessionUpdate === "tool_call") {
      // Back-to-back tool calls came out of the same model response.
      if (t - 300 - cursor > 500) llm(t - 300);
      started.set(update.toolCallId, {
        at: t,
        title: update.title,
        kind: update.kind ?? "other",
      });
    } else if (update.sessionUpdate === "tool_call_update") {
      const s = started.get(update.toolCallId);
      if (!s) continue;
      const failed = update.status === "failed";
      const tool = TOOL_NAMES[s.kind] ?? s.kind;
      const id = span(
        "claude_code.tool",
        rootId,
        s.at,
        t,
        { tool_name: tool, "tool.title": s.title },
        failed,
      );
      span("claude_code.tool.execution", id, s.at + 40, t - 20, {
        tool_name: tool,
        success: String(!failed),
      }, failed);
      log("claude_code.tool_result", t, id, "span-id", {
        tool_name: tool,
        success: String(!failed),
        duration_ms: String(t - s.at),
      });
      cursor = t + 200;
    }
  }
  llm(end - 100);

  return {
    turnId: TURN.turnId,
    promptId: TURN.promptId,
    startedAt: TURN.startedAt,
    durationMs: TURN.durationMs,
    spans,
    logs,
    spansTruncated: false,
    logsTruncated: false,
  };
}

export const TURN_DETAIL: TurnDetail = buildTurn();

export const TURN_REF = { agentId: AGENT, sessionId: SESSION };
