import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { InstancesRepository } from "../../modules/agents/infrastructure/instances-repository.js";
import { LAST_ACTIVITY_KEY, ACTIVE_SESSION_KEY } from "../../modules/agents/infrastructure/labels.js";
import type { ApprovalsRelayService } from "../../modules/approvals/compose.js";
import { acpNativeRowId } from "../../modules/approvals/domain/ids.js";

const DEBOUNCE_MS = 30_000;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: {
    sessionId?: string;
    options?: { optionId: string; kind?: string }[];
    toolCall?: { toolCallId?: string; title?: string; rawInput?: unknown };
  };
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: unknown;
}

function tryParse(data: unknown): unknown {
  try {
    return JSON.parse(typeof data === "string" ? data : (data as Buffer).toString("utf-8"));
  } catch {
    return null;
  }
}

function isPermissionRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === "object" && msg !== null &&
    (msg as JsonRpcRequest).method === "session/request_permission" &&
    typeof (msg as JsonRpcRequest).id !== "undefined"
  );
}

function isResponse(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as JsonRpcResponse;
  return (typeof m.id === "number" || typeof m.id === "string") && (m.result !== undefined || m.error !== undefined);
}

const lastActivityTimestamps = new Map<string, number>();

function sanitizeCloseCode(code: number): number {
  if (code === 1000 || (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006)) return code;
  if (code >= 3000 && code <= 4999) return code;
  return 1011;
}

function shouldUpdateActivity(instanceId: string): boolean {
  const now = Date.now();
  const last = lastActivityTimestamps.get(instanceId) ?? 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastActivityTimestamps.set(instanceId, now);
  return true;
}

function connectUpstream(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", (err) => {
      ws.close();
      reject(err);
    });
  });
}

/** Resolves an instance to its `(ownerSub, agentId)`. Injected by the
 *  composition root so the relay doesn't reach into the agents module's
 *  infrastructure for this lookup. */
export interface InstanceIdentityLookup {
  resolve(instanceId: string): Promise<{ ownerSub: string; agentId: string } | null>;
}

export function createAcpRelay(
  namespace: string,
  repo: InstancesRepository,
  approvals: ApprovalsRelayService,
  identityLookup: InstanceIdentityLookup,
) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      // Subscribe the inject channel for synth ext_authz frames bound for
      // this UI client. Unrelated to ACP-native delivery — that path is
      // outbox-driven and lives entirely in the approvals service.
      const unsubInjects = approvals.subscribeFrameInjects(instanceId, (frame) => {
        if (client.readyState === WebSocket.OPEN) client.send(frame);
      });
      client.once("close", () => unsubInjects());

      function mirrorPermissionRequest(msg: JsonRpcRequest): void {
        const sessionId = msg.params?.sessionId;
        if (!sessionId) return;
        identityLookup.resolve(instanceId).then((identity) => {
          if (!identity) return;
          const tc = msg.params.toolCall ?? {};
          const toolName = (tc.title as string | undefined) ?? "tool call";
          const options = (msg.params.options ?? []).map((o) => ({
            optionId: o.optionId,
            kind: o.kind as "allow_once" | "allow_always" | "reject_once" | "reject_always" | undefined,
          }));
          approvals.recordAcpNativePending({
            instanceId,
            sessionId,
            rpcId: msg.id,
            agentId: identity.agentId,
            ownerSub: identity.ownerSub,
            toolName,
            args: tc.rawInput,
            options,
          }).catch(() => {});
        }).catch(() => {});
      }

      function mirrorPermissionResponse(msg: JsonRpcResponse): void {
        // Compute the row id deterministically from `(instanceId, rpcId)`.
        // Non-permission responses produce a row id that doesn't exist in
        // pending_approvals; the CAS-resolve update affects zero rows and
        // silently no-ops. So we don't need an in-memory tracking map.
        const rowId = acpNativeRowId(instanceId, msg.id);
        approvals.resolveAcpNativeFromInSession(rowId).catch(() => {});
      }

      repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      const upstreamUrl = `ws://${podBaseUrl(instanceId, namespace)}/api/acp`;

      repo.ensureReady(instanceId)
        .then(() => connectUpstream(upstreamUrl))
        .then((upstream) => {
          repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

          for (const msg of pending) {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(msg.data, { binary: msg.isBinary });
            }
          }
          pending.length = 0;

          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data, { binary: isBinary });

              if (!isBinary) {
                const parsed = tryParse(data);
                if (isResponse(parsed)) mirrorPermissionResponse(parsed);
              }

              if (shouldUpdateActivity(instanceId)) {
                repo.patchAnnotation(
                  instanceId,
                  LAST_ACTIVITY_KEY, new Date().toISOString(),
                ).catch(() => {});
              }
            }
          });

          upstream.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(data, { binary: isBinary });

              if (!isBinary) {
                const parsed = tryParse(data);
                if (isPermissionRequest(parsed)) mirrorPermissionRequest(parsed);
              }
            }
          });

          upstream.on("close", (code, reason) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.close(sanitizeCloseCode(code), reason.toString() || "upstream closed");
              } catch {
                client.terminate();
              }
            }
          });

          upstream.on("error", () => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.close(1011, "upstream error");
              } catch {
                client.terminate();
              }
            }
          });

          client.on("close", () => {
            repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "").catch(() => {});
            // Inbox-driven verdicts no longer need this upstream — delivery
            // happens out-of-band via WrapperFrameSender on the click-handling
            // replica (or via the periodic sweep). Closing here is safe.
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.close();
            }
          });
        })
        .catch(() => {
          client.close(1011, "failed to connect to agent");
        });
    });
  }

  return { handleUpgrade };
}
