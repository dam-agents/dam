import { Hono } from "hono";
import type { Db } from "db";
import type { ArtifactService } from "../../artifacts/services/artifact-service.js";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../../agents/infrastructure/labels.js";
import {
  findActiveShareById,
  incrementShareQueryCount,
  markShareDirty,
  touchShareLastUsed,
} from "../infrastructure/kb-shares-repository.js";
import { createKbShareMcpApp } from "./kb-mcp-app.js";
import { createQueryLimits } from "./limits.js";
import { createSnapshotReader } from "./snapshot-reader.js";

const AGENT_NAME_TTL_MS = 60_000;

export function composeKbShareServing(opts: {
  db: Db;
  store: Pick<ArtifactService, "get">;
  k8s: K8sClient;
  grepDeadlineMs?: number;
}): Hono {
  const nameCache = new Map<string, { name: string; expiresAt: number }>();

  async function agentName(agentId: string): Promise<string> {
    const cached = nameCache.get(agentId);
    if (cached && cached.expiresAt > Date.now()) return cached.name;
    const obj = await opts.k8s
      .getCustomObject(AGENTS_PLURAL, agentId)
      .catch(() => null);
    const name = (obj?.spec as { name?: string } | undefined)?.name ?? agentId;
    nameCache.set(agentId, { name, expiresAt: Date.now() + AGENT_NAME_TTL_MS });
    return name;
  }

  const markDirty = markShareDirty(opts.db);
  return createKbShareMcpApp({
    findActiveById: findActiveShareById(opts.db),
    touchLastUsed: touchShareLastUsed(opts.db),
    incrementQueryCount: incrementShareQueryCount(opts.db),
    markShareDirty: async (agentId) => {
      await markDirty(agentId);
    },
    reader: createSnapshotReader(opts.store),
    agentName,
    limits: createQueryLimits(),
    ...(opts.grepDeadlineMs !== undefined
      ? { grepDeadlineMs: opts.grepDeadlineMs }
      : {}),
  });
}

export function createShareHostApp(deps: {
  viewer: { fetch: (req: Request) => Response | Promise<Response> };
  kbMcp: Hono;
  auth: Hono;
}): { fetch: (req: Request) => Response | Promise<Response> } {
  const app = new Hono();
  app.route("/", deps.kbMcp);
  app.route("/auth", deps.auth);
  app.all("*", (c) => deps.viewer.fetch(c.req.raw));
  return app;
}
