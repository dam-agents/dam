import { Hono } from "hono";
import type { SchedulesService, SkillsService } from "api-server-api";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import {
  mountPodFilesEventsRoute,
  type PodFilesEventsDeps,
} from "./pod-files-events.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

export interface TriggerRequest {
  schedule: string;
  task: string;
  sessionMode?: "continuous" | "fresh";
  mcpServers?: unknown[];
}

export interface TriggerResult {
  sessionId: string;
  stopReason?: string;
}

/**
 * ADR-039: every route below is per-instance — `/api/instances/:id/...`.
 * Caller identity is enforced upstream by an Istio AuthorizationPolicy
 * targeting the harness Service: the only principal allowed to hit
 * `/api/instances/<id>/*` is `cluster.local/ns/<agent-ns>/sa/<id>`. By
 * the time a request reaches a handler the path's `:id` already equals
 * the caller's per-instance ServiceAccount; handlers may treat the URL
 * `:id` as authenticated.
 */
export function createHarnessRouter(deps: {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
  handleTrigger: (instanceId: string, req: TriggerRequest) => Promise<TriggerResult>;
  podFiles: Pick<PodFilesEventsDeps, "bus" | "fetchSnapshot">;
  agentHome: string;
  schedulesServiceFor: (owner: string) => SchedulesService;
}) {
  const app = new Hono();

  app.post("/api/instances/:id/internal/trigger", async (c) => {
    const instanceId = c.req.param("id")!;
    const body = await c.req.json<TriggerRequest>();
    if (!body.schedule || !body.task) {
      return c.json({ error: "schedule, task required" }, 400);
    }
    const result = await deps.handleTrigger(instanceId, body);
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
