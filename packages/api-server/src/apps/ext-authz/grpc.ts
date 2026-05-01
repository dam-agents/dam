import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ExtAuthzGate } from "../../modules/approvals/compose.js";

/** Same metadata key as the L7 path. The Envoy filter renders it via
 *  `initial_metadata` on the per-instance bootstrap, mirroring how
 *  `headers_to_add` works for HTTP ext_authz. */
const INSTANCE_METADATA_KEY = "x-humr-instance";

/** google.rpc.Status codes — only OK and PERMISSION_DENIED are meaningful
 *  to Envoy's ext_authz client. */
const GRPC_STATUS_OK = 0;
const GRPC_STATUS_PERMISSION_DENIED = 7;

/** Sourced from the vendored minimal proto at `proto/external_auth.proto`. */
interface CheckRequest {
  attributes?: {
    source?: { address?: { socket_address?: { address?: string; port_value?: number } } };
    destination?: { address?: { socket_address?: { address?: string; port_value?: number } } };
    request?: {
      http?: {
        method?: string;
        headers?: Record<string, string>;
        path?: string;
        host?: string;
        scheme?: string;
      };
    };
    tls_session?: { sni?: string };
  };
}

interface CheckResponse {
  status: { code: number; message?: string };
}

export interface ExtAuthzGrpcAppDeps {
  port: number;
  /** Bound for the gRPC keepalive — must exceed the gate's hold deadline
   *  so the connection doesn't drop mid-wait while the user thinks. */
  holdSeconds: number;
  gate: ExtAuthzGate;
}

/**
 * gRPC ext_authz server. Envoy's network ext_authz filter is gRPC-only
 * (no HTTP variant), so this exists alongside the L7 HTTP endpoint to
 * gate non-credentialed traffic at the L4 layer. The Check handler
 * delegates to the same `ExtAuthzGate` the HTTP path uses — single
 * decider, two transports.
 */
/**
 * Resolves the vendored proto file across the dev/prod layout split. tsup
 * bundles `src/apps/ext-authz/grpc.ts` into `dist/index.js`, so the
 * `import.meta.url`-relative path differs between:
 *   - dev (tsx):     packages/api-server/src/apps/ext-authz/grpc.ts
 *                    → ../../../proto/external_auth.proto
 *   - prod (bundle): packages/api-server/dist/index.js
 *                    → proto/external_auth.proto (copied by tsup onSuccess)
 * Probe both candidates and return the first that exists; surface a clear
 * error if neither does so the operator sees the layout mismatch directly.
 */
function resolveProtoPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "proto/external_auth.proto"),               // bundled: dist/proto
    resolve(here, "../../../proto/external_auth.proto"),       // dev: src/apps/ext-authz
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `ext-authz: external_auth.proto not found. Tried: ${candidates.join(", ")}`,
  );
}

export async function startExtAuthzGrpcApp(deps: ExtAuthzGrpcAppDeps): Promise<{ server: grpc.Server }> {
  const protoPath = resolveProtoPath();
  const packageDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const grpcObj = grpc.loadPackageDefinition(packageDef) as unknown as {
    envoy: { service: { auth: { v3: { Authorization: { service: grpc.ServiceDefinition } } } } };
  };
  const authzService = grpcObj.envoy.service.auth.v3.Authorization.service;

  const server = new grpc.Server({
    "grpc.keepalive_time_ms": Math.min(60_000, deps.holdSeconds * 1000),
    "grpc.keepalive_timeout_ms": 20_000,
    "grpc.keepalive_permit_without_calls": 1,
  });

  server.addService(authzService, {
    Check: async (
      call: grpc.ServerUnaryCall<CheckRequest, CheckResponse>,
      callback: grpc.sendUnaryData<CheckResponse>,
    ) => {
      try {
        const instanceIdRaw = call.metadata.get(INSTANCE_METADATA_KEY);
        const instanceId = Array.isArray(instanceIdRaw) && instanceIdRaw.length > 0
          ? instanceIdRaw[0]?.toString()
          : null;
        if (!instanceId) {
          callback(null, denied("missing instance metadata"));
          return;
        }

        const req = call.request;
        const sni = req.attributes?.tls_session?.sni ?? null;
        const httpReq = req.attributes?.request?.http;
        // The HTTP filter copies `:authority` into `host`, which carries
        // the port for CONNECT (`example.com:443`) and may carry it for
        // proxied plain HTTP. Egress rules are written on bare hostnames,
        // so strip the port before lookup. SNI never carries a port.
        const rawHost = httpReq?.host ?? sni;
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
          method: httpReq?.method?.toUpperCase() ?? "*",
          path: httpReq?.path ?? "*",
        });
        callback(null, verdict === "allow" ? ok() : denied("policy denied"));
      } catch (err) {
        callback(null, denied(err instanceof Error ? err.message : "internal error"));
      }
    },
  });

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

function ok(): CheckResponse {
  return { status: { code: GRPC_STATUS_OK } };
}

function denied(message: string): CheckResponse {
  return { status: { code: GRPC_STATUS_PERMISSION_DENIED, message } };
}
