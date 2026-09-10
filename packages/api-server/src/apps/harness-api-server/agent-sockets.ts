import { createServer, type Server } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { chmodSync, chownSync } from "node:fs";
import { dirname } from "node:path";
import { getRequestListener } from "@hono/node-server";
import type * as grpc from "@grpc/grpc-js";
import type { Hono } from "hono";
import {
  startExtAuthzSocket,
  type ExtAuthzGrpcAppDeps,
} from "../ext-authz/grpc.js";
import { socketsFor } from "../../modules/sandboxes/domain/layout.js";
import { securityLog } from "../../core/security-log.js";

/**
 * The agent-facing control plane: a pair of unix sockets per running agent,
 * one for the harness API and one for ext_authz.
 *
 * Nothing here authenticates a bearer, because nothing presents one. The
 * boundary is the socket: it exists only while the agent runs, it is created
 * 0600 under the paired gateway's uid, and it names exactly one agent. A
 * harness request for a *different* agent's id is refused here, which is the
 * rule the waypoint's AuthorizationPolicy used to enforce by matching the
 * caller's SPIFFE principal against the URL.
 */

export interface AgentSockets {
  open(agentId: string): Promise<void>;
  close(agentId: string): Promise<void>;
  closeAll(): Promise<void>;
}

export function createAgentSockets(deps: {
  app: Hono;
  runRoot: string;
  extAuthz: ExtAuthzGrpcAppDeps;
  /** uid of the gateway processes, the only readers of these sockets. */
  gatewayUid: number;
  gatewayGid: number;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): AgentSockets {
  const open = new Map<string, { http: Server; grpc: grpc.Server }>();

  return {
    async open(agentId) {
      if (open.has(agentId)) return;
      const paths = socketsFor(deps.runRoot, agentId);
      for (const path of [paths.harness, paths.extAuthz]) {
        await mkdir(dirname(path), { recursive: true, mode: 0o750 });
        await rm(path, { force: true });
      }

      const http = createServer(
        getRequestListener(guard(agentId, deps.app, deps.log)),
      );
      await new Promise<void>((resolve, reject) => {
        http.once("error", reject);
        http.listen(paths.harness, () => {
          http.off("error", reject);
          resolve();
        });
      });
      // The pair is only reachable by the gateway, so a mode slip is the one
      // way another local process could speak for this agent.
      chmodSync(paths.harness, 0o600);
      chownSync(paths.harness, deps.gatewayUid, deps.gatewayGid);

      const rpc = await startExtAuthzSocket(
        agentId,
        paths.extAuthz,
        deps.extAuthz,
      );
      chmodSync(paths.extAuthz, 0o600);
      chownSync(paths.extAuthz, deps.gatewayUid, deps.gatewayGid);

      open.set(agentId, { http, grpc: rpc });
    },

    async close(agentId) {
      const listeners = open.get(agentId);
      if (!listeners) return;
      open.delete(agentId);
      await new Promise<void>((resolve) => listeners.http.close(() => resolve()));
      listeners.grpc.forceShutdown();
      const paths = socketsFor(deps.runRoot, agentId);
      await rm(paths.harness, { force: true });
      await rm(paths.extAuthz, { force: true });
    },

    async closeAll() {
      await Promise.all([...open.keys()].map((id) => this.close(id)));
    },
  };
}

/**
 * A socket serves one agent. A request naming another is the only shape that
 * could cross the boundary, so it is refused before the router sees it.
 */
function guard(
  agentId: string,
  app: Hono,
  log: (message: string, fields?: Record<string, unknown>) => void,
): (request: Request) => Response | Promise<Response> {
  return (request) => {
    const named = /\/api\/agents\/([^/]+)/.exec(new URL(request.url).pathname);
    if (named && decodeURIComponent(named[1]!) !== agentId) {
      securityLog("warn", "harness.socket.cross_agent", {
        category: "authz",
        actor: agentId,
        actorKind: "agent",
        surface: "harness",
        agentId,
        decision: "deny",
        reason: "socket-agent-mismatch",
        detail: { requested: named[1] },
      });
      log("harness.socket.cross_agent", { agentId, requested: named[1] });
      return new Response("forbidden", { status: 403 });
    }
    return app.fetch(request);
  };
}
