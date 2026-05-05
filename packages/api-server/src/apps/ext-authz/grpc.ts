import * as grpc from "@grpc/grpc-js";
import type { ExtAuthzGate } from "../../modules/approvals/compose.js";
import type { PodIpResolver } from "../../modules/instances/infrastructure/pod-ip-resolver.js";
import { parseGrpcPeer } from "../../modules/instances/infrastructure/pod-ip-resolver.js";
import {
  AuthorizationService,
  type AuthorizationServer,
  type CheckResponse,
  type Status,
} from "../../proto-gen/external_auth.gen.js";

/** Metadata key Envoy renders into every Check call from the per-instance
 *  bootstrap. Used as a defense-in-depth sanity check against the
 *  IP-derived identity, not as the primary auth signal. */
const INSTANCE_METADATA_KEY = "x-platform-instance";

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
  /** Resolves the calling pod's IP to an instance ID. The returned id is
   *  authoritative — pods can't spoof source IPs under K8s + standard
   *  CNIs without CAP_NET_RAW (we drop all caps), so this beats trusting
   *  any metadata header. See `pod-ip-resolver.ts` for the threat model. */
  podIpResolver: PodIpResolver;
}

/**
 * gRPC ext_authz server. Envoy's network ext_authz filter is gRPC-only
 * (no HTTP variant), so this exists alongside the L7 HTTP endpoint to
 * gate non-credentialed traffic at the L4 layer. The Check handler
 * delegates to the same `ExtAuthzGate` the HTTP path uses — single
 * decider, two transports.
 */
export async function startExtAuthzGrpcApp(deps: ExtAuthzGrpcAppDeps): Promise<{ server: grpc.Server }> {
  const server = new grpc.Server({
    "grpc.keepalive_time_ms": Math.min(60_000, deps.holdSeconds * 1000),
    "grpc.keepalive_timeout_ms": 20_000,
    "grpc.keepalive_permit_without_calls": 1,
  });

  const impl: AuthorizationServer = {
    check: async (call, callback) => {
      try {
        // Identity comes from the connection's source IP — the only field
        // an in-pod attacker cannot fake under our pod security context
        // (no CAP_NET_RAW, no hostNetwork). The CNI rewrites/drops any
        // non-pod source at egress on every CNI we care about.
        const peerIp = parseGrpcPeer(call.getPeer());
        const instanceId = peerIp ? deps.podIpResolver.resolve(peerIp) : null;
        if (!instanceId) {
          callback(null, denied(peerIp ? `unknown pod ${peerIp}` : "missing peer"));
          return;
        }

        // Defense-in-depth: Envoy always renders `x-platform-instance` into
        // initial_metadata from the per-instance bootstrap. The header is
        // required and must agree with the IP-derived identity. Missing
        // means someone bypassed Envoy (or bootstrap drift); mismatch
        // means a forged header (or bootstrap drift). Both fail closed.
        // Tooling that needs to call this endpoint outside Envoy must
        // include the matching header.
        const claimedRaw = call.metadata.get(INSTANCE_METADATA_KEY);
        const claimed = Array.isArray(claimedRaw) && claimedRaw.length > 0
          ? claimedRaw[0]?.toString()
          : null;
        if (!claimed) {
          process.stderr.write(
            `[ext-authz] missing ${INSTANCE_METADATA_KEY} from peer ${peerIp} (resolves to ${instanceId})\n`,
          );
          callback(null, denied("missing instance metadata"));
          return;
        }
        if (claimed !== instanceId) {
          process.stderr.write(
            `[ext-authz] identity mismatch: peer ${peerIp} resolves to ${instanceId} but metadata claims ${claimed}\n`,
          );
          callback(null, denied("identity mismatch"));
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

        // L4 path: only SNI is known, no method/path. Match against
        // wildcard rules. The repo's matcher orders most-specific first;
        // a `(host, *, *)` rule covers L4 traffic.
        const verdict = await deps.gate.gateRequest({
          instanceId,
          host,
          method: httpReq?.method?.toUpperCase() || "*",
          path: httpReq?.path || "*",
        });
        callback(null, verdict === "allow" ? ok() : denied("policy denied"));
      } catch (err) {
        callback(null, denied(err instanceof Error ? err.message : "internal error"));
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
        process.stderr.write(`ext-authz gRPC listening on 0.0.0.0:${deps.port}\n`);
        res();
      },
    );
  });
  return { server };
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
