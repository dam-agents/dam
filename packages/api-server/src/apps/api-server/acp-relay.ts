import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { InstancesRepository } from "../../modules/instances/infrastructure/instances-repository.js";
import {
  LAST_ACTIVITY_KEY,
  ACTIVE_SESSION_KEY,
} from "../../modules/agents/infrastructure/labels.js";
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
    return JSON.parse(
      typeof data === "string" ? data : (data as Buffer).toString("utf-8"),
    );
  } catch {
    return null;
  }
}

function isRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Partial<JsonRpcRequest>;
  return m.id !== undefined && typeof m.method === "string";
}

function isPermissionRequest(msg: unknown): msg is JsonRpcRequest {
  return isRequest(msg) && msg.method === "session/request_permission";
}

function isResponse(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Partial<JsonRpcResponse> & Partial<JsonRpcRequest>;
  if (m.id === undefined) return false;
  if (m.method !== undefined) return false;
  return m.result !== undefined || m.error !== undefined;
}

function extractRequestSessionId(req: JsonRpcRequest): string | null {
  const sid = req.params?.sessionId;
  return typeof sid === "string" ? sid : null;
}

const lastActivityTimestamps = new Map<string, number>();

function sanitizeCloseCode(code: number): number {
  if (
    code === 1000 ||
    (code >= 1001 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006)
  )
    return code;
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
  resolve(
    instanceId: string,
  ): Promise<{ ownerSub: string; agentId: string } | null>;
}

/** Persists a session row on first creation. Idempotent on conflict — repeated
 *  calls for the same sid no-op. Injected by the composition root so the relay
 *  doesn't reach into the sessions module directly. */
export type PersistSession = (
  sessionId: string,
  instanceId: string,
) => Promise<void>;

export function createAcpRelay(
  namespace: string,
  repo: InstancesRepository,
  approvals: ApprovalsRelayService,
  identityLookup: InstanceIdentityLookup,
  persistSession: PersistSession,
) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => {
        try {
          client.terminate();
        } catch {}
      });

      // Resolve identity once per upgrade. The instance's owner/agent
      // can't change for the lifetime of this WS — capturing here avoids
      // a K8s ConfigMap GET per permission-request mirror. Failure to
      // resolve fails the upgrade closed; without identity we'd write
      // pending_approvals rows the inbox query can't find.
      let identity: { ownerSub: string; agentId: string } | null = null;

      // Subscribe the inject channel for synth ext_authz frames bound for
      // this UI client. Unrelated to ACP-native delivery — that path is
      // outbox-driven and lives entirely in the approvals service.
      const unsubInjects = approvals.subscribeFrameInjects(
        instanceId,
        (frame) => {
          if (client.readyState === WebSocket.OPEN) client.send(frame);
        },
      );
      client.once("close", () => unsubInjects());

      function mirrorPermissionRequest(msg: JsonRpcRequest): void {
        const sessionId = msg.params?.sessionId;
        if (!sessionId || !identity) return;
        const tc = msg.params.toolCall ?? {};
        const toolName = (tc.title as string | undefined) ?? "tool call";
        const options = (msg.params.options ?? []).map((o) => ({
          optionId: o.optionId,
          kind: o.kind as
            | "allow_once"
            | "allow_always"
            | "reject_once"
            | "reject_always"
            | undefined,
        }));
        approvals
          .recordAcpNativePending({
            instanceId,
            sessionId,
            rpcId: msg.id,
            agentId: identity.agentId,
            ownerSub: identity.ownerSub,
            toolName,
            args: tc.rawInput,
            options,
          })
          .catch(() => {});
      }

      function mirrorPermissionResponse(msg: JsonRpcResponse): void {
        // Compute the row id deterministically from `(instanceId, rpcId)`.
        // Non-permission responses produce a row id that doesn't exist in
        // pending_approvals; the CAS-resolve update affects zero rows and
        // silently no-ops. So we don't need an in-memory tracking map.
        const rowId = acpNativeRowId(instanceId, msg.id);
        approvals.resolveAcpNativeFromInSession(rowId).catch(() => {});
      }

      repo
        .patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true")
        .catch(() => {});

      const pending: {
        data: Buffer | ArrayBuffer | Buffer[];
        isBinary: boolean;
      }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      const upstreamUrl = `ws://${podBaseUrl(instanceId, namespace)}/api/acp`;

      identityLookup
        .resolve(instanceId)
        .then((resolved) => {
          if (!resolved) {
            client.close(1011, "instance not found");
            throw new Error("instance not found");
          }
          identity = resolved;
        })
        .then(() => repo.ensureReady(instanceId))
        .then(() => connectUpstream(upstreamUrl))
        .then((upstream) => {
          repo
            .patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true")
            .catch(() => {});

          for (const msg of pending) {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(msg.data, { binary: msg.isBinary });
            }
          }
          pending.length = 0;

          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (upstream.readyState !== WebSocket.OPEN) return;

            if (shouldUpdateActivity(instanceId)) {
              repo
                .patchAnnotation(
                  instanceId,
                  LAST_ACTIVITY_KEY,
                  new Date().toISOString(),
                )
                .catch(() => {});
            }

            if (isBinary) {
              upstream.send(data, { binary: true });
              return;
            }

            const parsed = tryParse(data);

            // Persist on every session/prompt — upsertSession is idempotent on
            // conflict, so subsequent prompts on the same sid are PG no-ops.
            // Holding the frame until commit keeps DB row + agent state atomic
            // and makes the persist robust across WS reconnects.
            if (isRequest(parsed) && parsed.method === "session/prompt") {
              const sid = extractRequestSessionId(parsed);
              if (sid) {
                const requestId = parsed.id;
                persistSession(sid, instanceId).then(
                  () => {
                    if (upstream.readyState === WebSocket.OPEN) {
                      upstream.send(data, { binary: false });
                    } else if (client.readyState === WebSocket.OPEN) {
                      client.send(
                        JSON.stringify({
                          jsonrpc: "2.0",
                          id: requestId,
                          error: {
                            code: -32000,
                            message:
                              "upstream closed before prompt could be forwarded",
                          },
                        }),
                      );
                    }
                  },
                  (e: unknown) => {
                    if (client.readyState !== WebSocket.OPEN) return;
                    client.send(
                      JSON.stringify({
                        jsonrpc: "2.0",
                        id: requestId,
                        error: {
                          code: -32000,
                          message: `failed to persist session`,
                        },
                      }),
                    );
                  },
                );
                return;
              }
            }

            upstream.send(data, { binary: false });
            if (isResponse(parsed)) mirrorPermissionResponse(parsed);
          });

          upstream.on("message", (data, isBinary) => {
            if (client.readyState !== WebSocket.OPEN) return;

            if (isBinary) {
              client.send(data, { binary: true });
              return;
            }

            const parsed = tryParse(data);
            client.send(data, { binary: false });
            if (isPermissionRequest(parsed)) mirrorPermissionRequest(parsed);
          });

          upstream.on("close", (code, reason) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.close(
                  sanitizeCloseCode(code),
                  reason.toString() || "upstream closed",
                );
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
            repo
              .patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "")
              .catch(() => {});
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
