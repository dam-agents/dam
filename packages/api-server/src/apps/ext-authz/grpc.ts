import * as grpc from "@grpc/grpc-js";
import type { ExtAuthzGate } from "../../modules/approvals/compose.js";
import {
  AuthorizationService,
  type AuthorizationServer,
  type CheckResponse,
  type Status,
} from "../../proto-gen/external_auth.gen.js";

/** google.rpc.Status codes — only OK and PERMISSION_DENIED are meaningful
 *  to Envoy's ext_authz client. */
const GRPC_STATUS_OK = 0;
const GRPC_STATUS_PERMISSION_DENIED = 7;

export interface ExtAuthzGrpcAppDeps {
  port: number;
  /** Bound for the gRPC keepalive — must exceed the gate's hold deadline
   *  so the connection doesn't drop mid-wait while the user thinks. */
  holdSeconds: number;
  gate: ExtAuthzGate;
  /** Helm release name + agent namespace, used to parse instance ID
   *  from the per-instance ext-authz Service hostname Envoy dialled.
   *  ADR-041: identity is derived from the destination Service the
   *  gateway pod's Envoy was configured to dial. The Istio
   *  AuthorizationPolicy on each per-instance Service ensures only the
   *  matching SA principal can reach it, so the destination Service IS
   *  cryptographically pinned to the calling instance. */
  releaseName: string;
}

/**
 * gRPC ext_authz server. Envoy's network ext_authz filter is gRPC-only
 * (no HTTP variant), so this exists alongside the L7 HTTP endpoint to
 * gate non-credentialed traffic at the L4 layer. The Check handler
 * delegates to the same `ExtAuthzGate` the HTTP path uses — single
 * decider, two transports.
 *
 * ADR-041: instance identity is derived from the gRPC `:authority` of the
 * per-instance ext-authz Service (`<release>-extauthz-<id>`). The
 * AuthorizationPolicy on that Service ALLOWs only the matching SA
 * principal — by the time a request reaches this handler, the gateway
 * pod has already proven its SPIFFE identity to the mesh. The pod-IP
 * resolver and the `x-platform-instance` initial-metadata header are
 * gone; identity flows purely through Service routing + mesh policy.
 */
export async function startExtAuthzGrpcApp(
  deps: ExtAuthzGrpcAppDeps,
): Promise<{ server: grpc.Server }> {
  const server = new grpc.Server({
    "grpc.keepalive_time_ms": Math.min(60_000, deps.holdSeconds * 1000),
    "grpc.keepalive_timeout_ms": 20_000,
    "grpc.keepalive_permit_without_calls": 1,
  });

  const expectedPrefix = `${deps.releaseName}-extauthz-`;

  const impl: AuthorizationServer = {
    check: async (call, callback) => {
      try {
        // ADR-041: extract instance ID from the gRPC :authority — i.e. the
        // per-instance ext-authz Service hostname Envoy dialled. grpc-js
        // exposes :authority via the public `getHost()` on ServerSurfaceCall;
        // pseudo-headers are NOT in `call.metadata`. Fail closed if the
        // host is missing or doesn't match the expected per-instance
        // Service prefix — there is no other identity signal to fall back
        // to under this design (the AuthorizationPolicy on each Service
        // already gates by SA principal, so a non-matching host can only
        // come from an out-of-mesh caller or a misconfigured client).
        const authority = call.getHost();
        const agentId = parseInstanceFromAuthority(authority, expectedPrefix);
        if (!agentId) {
          process.stderr.write(
            `[ext-authz] denied: unparsable :authority='${authority}'\n`,
          );
          callback(
            null,
            denied(`unable to derive instance from :authority='${authority}'`),
          );
          return;
        }

        const httpReq = call.request.attributes?.request?.http;
        const sni = call.request.attributes?.tlsSession?.sni ?? null;
        // The HTTP filter copies `:authority` into `host`, which carries
        // the port for CONNECT (`example.com:443`) and may carry it for
        // proxied plain HTTP. Egress rules are written on bare hostnames,
        // so strip the port before lookup. SNI never carries a port.
        const rawHost = httpReq?.host || sni;
        const host = rawHost ? stripPort(rawHost) : null;
        if (!host) {
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
      `0.0.0.0:${deps.port}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => {
        if (err) {
          rej(err);
          return;
        }
        process.stderr.write(
          `ext-authz gRPC listening on 0.0.0.0:${deps.port}\n`,
        );
        res();
      },
    );
  });
  return { server };
}

/** Parse `<id>` from `<release>-extauthz-<id>.<ns>.svc.cluster.local[:port]`.
 *  Returns null if the host doesn't match the expected per-instance Service
 *  prefix — i.e. the gateway pod somehow dialled a non-per-instance host,
 *  which the AuthorizationPolicy stack should already prevent. */
function parseInstanceFromAuthority(
  authority: string,
  expectedPrefix: string,
): string | null {
  if (!authority) return null;
  const stripped = stripPort(authority);
  // First DNS label is the Service name (e.g. `platform-extauthz-abc`).
  const firstLabel = stripped.split(".")[0] ?? "";
  if (!firstLabel.startsWith(expectedPrefix)) return null;
  const id = firstLabel.slice(expectedPrefix.length);
  return id || null;
}

/** Strip the trailing `:port` from a host. Handles bare IPv4/hostname
 *  (`example.com:443` → `example.com`) and bracketed IPv6
 *  (`[::1]:443` → `[::1]`). Hosts without a port pass through. */
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
