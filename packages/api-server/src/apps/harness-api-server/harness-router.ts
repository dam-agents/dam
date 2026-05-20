import { Hono } from "hono";
import type { SchedulesService, SkillsService } from "api-server-api";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import {
  mountPodFilesEventsRoute,
  type PodFilesEventsDeps,
} from "./pod-files-events.js";
import { resolveAgent } from "./agent-auth.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

export interface TriggerRequest {
  agentId: string;
  schedule: string;
  task: string;
  sessionMode?: "continuous" | "fresh";
  mcpServers?: unknown[];
}

export interface TriggerResult {
  sessionId: string;
  stopReason?: string;
}

export function createHarnessRouter(deps: {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  handleTrigger: (req: TriggerRequest) => Promise<TriggerResult>;
  podFiles: Pick<PodFilesEventsDeps, "bus" | "fetchSnapshot">;
  agentHome: string;
  schedulesServiceFor: (owner: string) => SchedulesService;
}) {
  const app = new Hono();

  // ADR-041: trigger endpoint moved under /api/agents/:id/* so it falls
  // under the same per-instance AuthorizationPolicy as MCP and pod-files.
  // The waypoint enforces principal == URL :id; the body's `agentId`
  // field is preserved for compatibility but ignored — the URL is the
  // source of truth.
  app.post("/api/agents/:id/internal/trigger", async (c) => {
    const agentId = c.req.param("id")!;
    const body = await c.req.json<TriggerRequest>();
    if (!body.schedule || !body.task) {
      return c.json({ error: "schedule, task required" }, 400);
    }
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) {
      return c.json({ error: "not found" }, 404);
    }
    const result = await deps.handleTrigger({ ...body, agentId });
    return c.json(result);
  });

  mountMcpRoutes(app, {
    channelManager: deps.channelManager,
    k8s: deps.k8s,
    composeSkills: deps.composeSkills,
    agentHome: deps.agentHome,
    schedulesServiceFor: deps.schedulesServiceFor,
  });
  mountPodFilesEventsRoute(app, {
    k8s: deps.k8s,
    bus: deps.podFiles.bus,
    fetchSnapshot: deps.podFiles.fetchSnapshot,
  });

  return app;
}
