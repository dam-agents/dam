import { Hono } from "hono";
import type { SchedulesService, SkillsService } from "api-server-api";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import {
  mountPodFilesEventsRoute,
  type PodFilesEventsDeps,
} from "./pod-files-events.js";
import { verifyInstanceFromHeader } from "./instance-auth.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

export interface TriggerRequest {
  instanceId: string;
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

  app.post("/internal/trigger", async (c) => {
    const body = await c.req.json<TriggerRequest>();
    if (!body.instanceId || !body.schedule || !body.task) {
      return c.json({ error: "instanceId, schedule, task required" }, 400);
    }
    // The body's `instanceId` must match the trusted header that the
    // gateway pod's Envoy stamps; without this an instance could fire
    // triggers for someone else's instance even though it can only have
    // the header for its own pair.
    const verified = await verifyInstanceFromHeader(deps.k8s, c, body.instanceId);
    if (!verified) {
      return c.json({ error: "not found" }, 404);
    }
    const result = await deps.handleTrigger(body);
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
