import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { json, run } from "../../core/mcp-tool-result.js";
import {
  agentMetricsInputSchema,
  agentTelemetryInputSchema,
} from "api-server-api";
import type { AgentTelemetryService } from "./services/agent-telemetry.js";

const SELF =
  "Reads this agent's own telemetry only — it is scoped to the caller and can never return another agent's.";

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
    "get_metrics",
    `What this agent's runs cost and how long they took, from the platform's own attributed accounting — always prefer it over estimating cost or counting tokens out of a transcript. Returns window totals and a per-model token/cost split, and with granularity adds a row per session or a row per LLM call. ${SELF} Totals and sessionCount always cover the whole window; a row list is capped at limit and flags truncated. ${UNMEASURED}`,
    agentMetricsInputSchema.shape,
    (query) =>
      run(async () =>
        json(await deps.agentTelemetry.metrics(deps.agentId, query)),
      ),
  );

  server.tool(
    "get_logs",
    `The telemetry records this agent emitted, newest first: record name, severity, timestamp, session, trace and the structural attributes attached to it — errors and tool decisions included. Content bodies are never exported, so this carries no prompt or tool-argument text. ${SELF} ${UNMEASURED}`,
    agentTelemetryInputSchema.shape,
    (query) =>
      run(async () =>
        json(await deps.agentTelemetry.logs(deps.agentId, query)),
      ),
  );

  server.tool(
    "get_spans",
    `This agent's trace spans, newest first: span and parent ids, name, kind, service, start, duration and status — the shape of a run, showing what ran under what and which step was slow or failed. A sessionId is resolved through that session's LLM-call records; naming a session with none returns sessionUnresolved rather than an empty list. ${SELF} ${UNMEASURED}`,
    agentTelemetryInputSchema.shape,
    (query) =>
      run(async () =>
        json(await deps.agentTelemetry.spans(deps.agentId, query)),
      ),
  );
}
