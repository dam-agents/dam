import { Hono } from "hono";
import type { SchedulesService, SkillsService } from "api-server-api";
import { mountMcpRoutes } from "./mcp-endpoint.js";
import {
  getPeerInstanceId,
  peerIdentityMiddleware,
  type PeerIdentityVars,
} from "./peer-identity.js";
import {
  mountPodFilesEventsRoute,
  type PodFilesEventsDeps,
} from "./pod-files-events.js";
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
  /** Istio SPIFFE trust domain — `cluster.local` by default (ADR-039). */
  istioTrustDomain: string;
  /** Namespace agent + gateway pods run in. Peer principals from any other
   *  namespace are rejected at the middleware. */
  agentNamespace: string;
}) {
  const app = new Hono<{ Variables: PeerIdentityVars }>();

  // ADR-039: every harness-port request carries an Istio peer principal in
  // `x-forwarded-client-cert`. The middleware rejects anything missing or
  // malformed; downstream handlers cross-check the peer SA name against the
  // URL `:id` (or trigger body's instanceId).
  app.use(
    "*",
    peerIdentityMiddleware({
      trustDomain: deps.istioTrustDomain,
      agentNamespace: deps.agentNamespace,
    }),
  );

  app.post("/internal/trigger", async (c) => {
    const body = await c.req.json<TriggerRequest>();
    if (!body.instanceId || !body.schedule || !body.task) {
      return c.json({ error: "instanceId, schedule, task required" }, 400);
    }
    // Triggers fire from agent-runtime (long-lived or fork) using
    // ADK_INSTANCE_ID = the parent instance. Per-instance SA == parent
    // instance, so peer SA must equal body.instanceId for both shapes.
    if (getPeerInstanceId(c) !== body.instanceId) {
      return c.json({ error: "forbidden" }, 403);
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
