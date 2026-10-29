import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Hono } from "hono";
import type {
  ArtifactTouchService,
  HarnessContext,
  InvocationScriptReports,
  KbPublishGate,
  RuntimeDeliveryService,
  SessionDirectoryService,
  SpendCallCostReader,
  ToolApprovalReports,
} from "api-server-api";
import { harnessRouter } from "api-server-api/harness-router";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import { resolveAgent } from "./agent-auth.js";
import { MAX_TRPC_BATCH_SIZE } from "../../core/request-body-bounds.js";

export interface RuntimeTrpcDeps {
  k8s: K8sClient;
  readAgent: (id: string) => Promise<KubeObject | null>;
  hello: RuntimeDeliveryService;
  sessionDirectory: SessionDirectoryService;
  artifactTouchesFor: (owner: string) => ArtifactTouchService;
  kbPublish: KbPublishGate;
  toolApprovalsFor: (owner: string) => ToolApprovalReports;
  invocationScripts: InvocationScriptReports;
  spendCalls: SpendCallCostReader;
}

export function mountRuntimeTrpc(app: Hono, deps: RuntimeTrpcDeps): void {
  app.all("/api/agents/:id/trpc/*", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.readAgent, agentId);
    if (!verified) {
      return c.json({ error: "not found" }, 404);
    }

    const url = new URL(c.req.url);
    const prefix = `/api/agents/${encodeURIComponent(agentId)}/trpc`;
    const path = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/^\/+/, "")
      : url.pathname;

    return fetchRequestHandler({
      endpoint: "",
      req: new Request(`${url.origin}/${path}${url.search}`, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body:
          c.req.method === "GET" || c.req.method === "HEAD"
            ? undefined
            : c.req.raw.body,
        duplex: "half",
      } as RequestInit),
      router: harnessRouter,
      maxBatchSize: MAX_TRPC_BATCH_SIZE,
      createContext: (): HarnessContext => ({
        agentId,
        runtimeDelivery: deps.hello,
        sessionDirectory: deps.sessionDirectory,
        artifactTouches: deps.artifactTouchesFor(verified.owner),
        kbPublish: deps.kbPublish,
        toolApprovals: deps.toolApprovalsFor(verified.owner),
        invocationScripts: deps.invocationScripts,
        spendCalls: deps.spendCalls,
      }),
    });
  });
}
