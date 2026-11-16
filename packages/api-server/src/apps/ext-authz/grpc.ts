import * as grpc from "@grpc/grpc-js";
import { match } from "ts-pattern";
import type {
  ExtAuthzDecision,
  ExtAuthzGate,
  ModelCallBody,
} from "../../modules/approvals/compose.js";
import {
  parseSpendMetadata,
  SPEND_METADATA_NAMESPACE,
  type SpendIngest,
} from "../../modules/spend/index.js";
import { securityLog } from "../../core/security-log.js";
import { stripConnectionEgressPrefix } from "api-server-api";
import {
  AuthorizationService,
  type AuthorizationServer,
  type CheckResponse,
} from "../../proto-gen/external_auth.gen.js";
import { AccessLogServiceService } from "../../proto-gen/accesslog.gen.js";
import { createSpendRecordStreams } from "./spend-records.js";

const GRPC_STATUS_OK = 0;
const GRPC_STATUS_PERMISSION_DENIED = 7;

// UNIT_BOUNDARY_DESCRIPTION: the largest Check the server takes: a gateway with web search control sends a model call's whole body, up to the Messages API's 32 MiB, and the request's attributes ride beside it.
const MAX_CHECK_BYTES = 33 << 20;
const PARTIAL_BODY_HEADER = "x-envoy-auth-partial-body";

export interface ExtAuthzGrpcAppDeps {
  port: number;
  holdSeconds: number;
  gate: ExtAuthzGate;
  spend: SpendIngest;
  releaseName: string;
}

export async function startExtAuthzGrpcApp(
  deps: ExtAuthzGrpcAppDeps,
): Promise<{ port: number; stop(deadlineMs: number): Promise<void> }> {
  const server = new grpc.Server({
    "grpc.keepalive_time_ms": Math.min(60_000, deps.holdSeconds * 1000),
    "grpc.keepalive_timeout_ms": 20_000,
    "grpc.keepalive_permit_without_calls": 1,
    "grpc.max_receive_message_length": MAX_CHECK_BYTES,
  });

  const expectedPrefix = `${deps.releaseName}-extauthz-`;
  const spendRecords = createSpendRecordStreams({
    agentFromAuthority: (authority) =>
      parseInstanceFromAuthority(authority, expectedPrefix),
    ingest: deps.spend,
  });

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

        const meter =
          call.request.attributes?.metadataContext?.filterMetadata[
            SPEND_METADATA_NAMESPACE
          ];
        const spend = parseSpendMetadata(meter);
        const decision = await deps.gate.gateRequest({
          agentId,
          host,
          port,
          tls,
          method,
          path: httpReq?.path ? stripConnectionEgressPrefix(httpReq.path) : "*",
          modelCall: meter
            ? { sessionId: spend?.sessionId ?? null }
            : undefined,
          body: httpReq ? modelCallBodyOf(httpReq) : undefined,
          spendCall: spend && {
            callId: spend.callId,
            payer: spend.payer,
            connectionId: spend.connectionId,
            providers: spend.providers,
            sessionId: spend.sessionId,
            routerCallId: spend.routerCallId,
            dialect: spend.dialect,
          },
        });
        callback(null, checkResponseOf(decision));
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
  server.addService(AccessLogServiceService, spendRecords.service);

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

  const stop = async (deadlineMs: number) => {
    const drained = new Promise<boolean>((res) =>
      server.tryShutdown(() => res(true)),
    );
    spendRecords.endAll();
    const deadline = new Promise<boolean>((res) =>
      setTimeout(() => res(false), deadlineMs).unref(),
    );
    if (!(await Promise.race([drained, deadline]))) server.forceShutdown();
  };
  return { port, stop };
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

// UNIT_BOUNDARY_DESCRIPTION: the body a Check carries, as the gateway sent it. Only a gateway that reads bodies fills it, and the agent can set any header but never the body field, so an empty body on a request whose length headers say it has one is a body the gateway did not read. A body shorter than its declared length, or one Envoy marks as partial, was read in part.
export function modelCallBodyOf(httpReq: {
  headers: Record<string, string>;
  rawBody: Uint8Array;
}): ModelCallBody {
  const bytes = httpReq.rawBody;
  const length = httpReq.headers["content-length"];
  const chunked = httpReq.headers["transfer-encoding"] !== undefined;
  if (bytes.length === 0)
    return {
      sent: false,
      declared: chunked || (length !== undefined && Number(length) !== 0),
    };
  return {
    sent: true,
    partial:
      httpReq.headers[PARTIAL_BODY_HEADER] === "true" ||
      (length !== undefined && Number(length) !== bytes.length),
    bytes,
  };
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
  return {
    status: { code: GRPC_STATUS_PERMISSION_DENIED, message },
    deniedResponse: undefined,
  };
}

function checkResponseOf(decision: ExtAuthzDecision): CheckResponse {
  return match(decision)
    .with("allow", () => ({
      status: { code: GRPC_STATUS_OK, message: "" },
      deniedResponse: undefined,
    }))
    .with("deny", () => denied("policy denied"))
    .with({ verdict: "refuse" }, ({ basis, response }) => ({
      status: {
        code: GRPC_STATUS_PERMISSION_DENIED,
        message: basis === "spend" ? "spend limit" : "policy denied",
      },
      deniedResponse: {
        status: { code: response.status },
        headers: Object.entries(response.headers).map(([key, value]) => ({
          header: { key, value },
        })),
        body: response.body,
      },
    }))
    .exhaustive();
}
