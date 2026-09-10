import * as grpc from "@grpc/grpc-js";
import type { ExtAuthzGate } from "../../modules/approvals/compose.js";
import { securityLog } from "../../core/security-log.js";
import {
  AuthorizationService,
  type AuthorizationServer,
  type CheckResponse,
  type Status,
} from "../../proto-gen/external_auth.gen.js";

const GRPC_STATUS_OK = 0;
const GRPC_STATUS_PERMISSION_DENIED = 7;

export interface ExtAuthzGrpcAppDeps {
  holdSeconds: number;
  gate: ExtAuthzGate;
}

/**
 * One ext_authz server per agent, on that agent's own unix socket.
 *
 * The agent id is bound here rather than parsed off `:authority`: the socket
 * is created 0600 under the paired gateway's uid, so arriving on it is proof
 * of which gateway is asking. That is the same guarantee the per-agent
 * AuthorizationPolicy gave by matching the caller's SPIFFE principal, minus
 * the mesh — and unlike the authority header, it is not something the caller
 * can choose.
 */
export async function startExtAuthzSocket(
  agentId: string,
  socketPath: string,
  deps: ExtAuthzGrpcAppDeps,
): Promise<grpc.Server> {
  const server = new grpc.Server({
    "grpc.keepalive_time_ms": Math.min(60_000, deps.holdSeconds * 1000),
    "grpc.keepalive_timeout_ms": 20_000,
    "grpc.keepalive_permit_without_calls": 1,
  });

  const impl: AuthorizationServer = {
    check: async (call, callback) => {
      try {
        const httpReq = call.request.attributes?.request?.http;
        const sni = call.request.attributes?.tlsSession?.sni ?? null;
        const rawHost = httpReq?.host || sni;
        const host = rawHost ? stripPort(rawHost) : null;
        if (!host) {
          securityLog("warn", "egress.decision", {
            category: "egress",
            actor: null,
            actorKind: "agent",
            surface: "ext-authz",
            agentId,
            decision: "deny",
            reason: "missing-host",
          });
          callback(null, denied("missing host/sni"));
          return;
        }

        const verdict = await deps.gate.gateRequest({
          agentId,
          host,
          method: httpReq?.method?.toUpperCase() || "*",
          path: httpReq?.path || "*",
        });
        callback(null, verdict === "allow" ? ok() : denied("policy denied"));
      } catch (err) {
        securityLog("error", "egress.decision", {
          category: "egress",
          actor: null,
          actorKind: "agent",
          surface: "ext-authz",
          decision: "deny",
          result: "failure",
          reason: "internal-error",
          detail: { error: err instanceof Error ? err.message : "unknown" },
        });
        callback(
          null,
          denied(err instanceof Error ? err.message : "internal error"),
        );
      }
    },
  };

  server.addService(AuthorizationService, impl);

  await new Promise<void>((res, rej) => {
    server.bindAsync(
      `unix://${socketPath}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? rej(err) : res()),
    );
  });
  return server;
}

function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const idx = host.lastIndexOf(":");
  return idx === -1 ? host : host.slice(0, idx);
}

function makeStatus(code: number, message?: string): Status {
  return { code, message: message ?? "" };
}

function ok(): CheckResponse {
  return { status: makeStatus(GRPC_STATUS_OK) };
}

function denied(message: string): CheckResponse {
  return { status: makeStatus(GRPC_STATUS_PERMISSION_DENIED, message) };
}
