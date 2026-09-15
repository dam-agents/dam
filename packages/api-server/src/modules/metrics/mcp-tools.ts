import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { json, run } from "../../core/mcp-tool-result.js";
import {
  agentTelemetryRecordsInputSchema,
  usageSummaryInputSchema,
} from "api-server-api";
import type { AgentTelemetryService } from "./services/agent-telemetry.js";

const UNMEASURED =
  "When it returns available=false, this deployment does not measure telemetry; say so instead of estimating.";

export function registerAgentTelemetryTools(
  server: McpServer,
  deps: {
    agentId: string;
    agentTelemetry: AgentTelemetryService;
  },
): void {
  server.tool(
    "get_usage_summary",
    `Report this agent's own LLM usage from the platform's telemetry: total cost in USD, total model time, per-model token/cost split, and a per-session breakdown carrying each session's call count, model time, tokens, cost and first/last activity. This is the platform's own attributed accounting — always prefer it over estimating cost or counting tokens out of transcripts. Pass sessionId to scope it to one session. ${UNMEASURED}`,
    usageSummaryInputSchema.shape,
    ({ days, sessionId }) =>
      run(async () =>
        json(
          await deps.agentTelemetry.summary(deps.agentId, { days, sessionId }),
        ),
      ),
  );

  server.tool(
    "get_llm_calls",
    `List this agent's own LLM calls, newest first: timestamp, model, request latency, tokens in and out, context size and cost per call. Use it to find where a slow or expensive run spent its time, rather than inferring from the transcript. ${UNMEASURED}`,
    agentTelemetryRecordsInputSchema.shape,
    ({ days, sessionId, limit }) =>
      run(async () =>
        json(
          await deps.agentTelemetry.llmCalls(deps.agentId, {
            days,
            sessionId,
            limit,
          }),
        ),
      ),
  );

  server.tool(
    "get_telemetry_events",
    `List the telemetry records this agent emitted, newest first: the record name, severity, timestamp, session, trace and the structural attributes attached to it — including errors and tool decisions. Content bodies are never exported, so this carries no prompt or tool-argument text. ${UNMEASURED}`,
    agentTelemetryRecordsInputSchema.shape,
    ({ days, sessionId, limit }) =>
      run(async () =>
        json(
          await deps.agentTelemetry.telemetryEvents(deps.agentId, {
            days,
            sessionId,
            limit,
          }),
        ),
      ),
  );

  server.tool(
    "get_trace_spans",
    `List this agent's own trace spans, newest first: span and parent ids, name, kind, service, start, duration and status. Use it to see the shape of a run — what ran under what, and which step was slow or failed. ${UNMEASURED}`,
    agentTelemetryRecordsInputSchema.shape,
    ({ days, sessionId, limit }) =>
      run(async () =>
        json(
          await deps.agentTelemetry.traceSpans(deps.agentId, {
            days,
            sessionId,
            limit,
          }),
        ),
      ),
  );
}
