import * as grpc from "@grpc/grpc-js";
import type { ExtAuthzGate } from "../../modules/approvals/compose.js";
import { securityLog } from "../../core/security-log.js";
import { stripConnectionEgressPrefix } from "api-server-api";
import {
  AuthorizationService,
  type AuthorizationServer,
  type CheckResponse,
} from "../../proto-gen/external_auth.gen.js";

const GRPC_STATUS_OK = 0;
const GRPC_STATUS_PERMISSION_DENIED = 7;

export interface ExtAuthzGrpcAppDeps {
  port: number;
  holdSeconds: number;
  gate: ExtAuthzGate;
  releaseName: string;
}

export async function startExtAuthzGrpcApp(
  deps: ExtAuthzGrpcAppDeps,
): Promise<{ server: grpc.Server; port: number }> {
  const server = new grpc.Server({
    "grpc.keepalive_time_ms": Math.min(60_000, deps.holdSeconds * 1000),
    "grpc.keepalive_timeout_ms": 20_000,
    "grpc.keepalive_permit_without_calls": 1,
  });

  const expectedPrefix = `${deps.releaseName}-extauthz-`;

  const impl: AuthorizationServer = {
    check: async (call, callback) => {
      try {
        const authority = call.getHost();
        const agentId = parseInstanceFromAuthority(authority, expectedPrefix);
        if (!agentId) {
          securityLog("warn", "egress.decision", {
            category: "egress",
            actor: null,
            actorKind: "agent",
            surface: "ext-authz",
            decision: "deny",
            reason: "unparsable-authority",
            detail: { authority },
          });
          callback(
            null,
            denied(`unable to derive instance from :authority='${authority}'`),
          );
          return;
        }

        const httpReq = call.request.attributes?.request?.http;
        const sni = call.request.attributes?.tlsSession?.sni ?? null;
        const rawHost = httpReq?.host || sni;
        const host = rawHost ? stripPort(rawHost) : null;
        const method = httpReq?.method?.toUpperCase() || "*";
        const tls =
          !httpReq || method === "CONNECT" || httpReq.scheme === "https";
        const portText = rawHost?.slice(host?.length ?? 0).replace(/^:/, "");
        const port = !portText
          ? tls
            ? 443
            : 80
          : /^\d{1,5}$/.test(portText)
            ? Number(portText)
            : 0;
        if (!host || port < 1 || port > 65535) {
          securityLog("warn", "egress.decision", {
            category: "egress",
            actor: null,
            actorKind: "agent",
            surface: "ext-authz",
            agentId,
            decision: "deny",
            reason: "missing-host",
          });
          callback(null, denied("missing or malformed host/sni"));
          return;
        }

        const verdict = await deps.gate.gateRequest({
          agentId,
          host,
          port,
          tls,
          method,
          path: httpReq?.path ? stripConnectionEgressPrefix(httpReq.path) : "*",
        });
        callback(
          null,
          verdict === "allow"
            ? { status: { code: GRPC_STATUS_OK, message: "" } }
            : denied("policy denied"),
        );
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

  const port = await new Promise<number>((res, rej) => {
    server.bindAsync(
      `0.0.0.0:${deps.port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) {
          rej(err);
          return;
        }
        process.stderr.write(
          `ext-authz gRPC listening on 0.0.0.0:${boundPort}\n`,
        );
        res(boundPort);
      },
    );
  });
  return { server, port };
}

function parseInstanceFromAuthority(
  authority: string,
  expectedPrefix: string,
): string | null {
  if (!authority) return null;
  const stripped = stripPort(authority);
  const firstLabel = stripped.split(".")[0] ?? "";
  if (!firstLabel.startsWith(expectedPrefix)) return null;
  const id = firstLabel.slice(expectedPrefix.length);
  return id || null;
}

function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const idx = host.lastIndexOf(":");
  return idx === -1 ? host : host.slice(0, idx);
}

function denied(message: string): CheckResponse {
  return { status: { code: GRPC_STATUS_PERMISSION_DENIED, message } };
}
