import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { InstancesRepository } from "../../modules/instances/infrastructure/instances-repository.js";
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

/**
 * Catch-handler factory for `patchAnnotation` calls. Annotation failures
 * are non-fatal — the annotation is a UI-presence hint, not auth state —
 * but they signal real problems (RBAC drift, K8s API hiccup, network
 * partition) that operators need to see. Previously these were swallowed
 * with `.catch(() => {})`.
 */
function warnOnPatchFailure(label: string): (err: unknown) => void {
  return (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[acp-relay] ${label} failed: ${msg}`);
  };
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
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => {
        try { client.terminate(); } catch {}
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
      const unsubInjects = approvals.subscribeFrameInjects(instanceId, (frame) => {
        if (client.readyState === WebSocket.OPEN) client.send(frame);
      });
      client.once("close", () => unsubInjects());

      function mirrorPermissionRequest(msg: JsonRpcRequest): void {
        const sessionId = msg.params?.sessionId;
        if (!sessionId || !identity) return;
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
      }

      function mirrorPermissionResponse(msg: JsonRpcResponse): void {
        // Compute the row id deterministically from `(instanceId, rpcId)`.
        // Non-permission responses produce a row id that doesn't exist in
        // pending_approvals; the CAS-resolve update affects zero rows and
        // silently no-ops. So we don't need an in-memory tracking map.
        const rowId = acpNativeRowId(instanceId, msg.id);
        approvals.resolveAcpNativeFromInSession(rowId).catch(() => {});
      }

      repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true")
        .catch(warnOnPatchFailure(`patch ${ACTIVE_SESSION_KEY}=true`));

      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      // Lifecycle bookkeeping for the upstream-dial → handler-attach window.
      //
      // `upstream` is null until `connectUpstream` resolves; if the client
      // closes during that window, `clientClosedDuringDial` is set so the
      // `.then` aborts and tears down the upstream once it does come up.
      // Without this, a client that disconnects mid-dial leaks the upstream
      // WS — the close handler used to be attached *inside* `.then`, so a
      // pre-dial close left no cleanup hook.
      let upstream: WebSocket | null = null;
      let clientClosedDuringDial = false;

      client.on("close", () => {
        repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "")
          .catch(warnOnPatchFailure(`clear ${ACTIVE_SESSION_KEY}`));
        if (upstream === null) {
          clientClosedDuringDial = true;
          return;
        }
        // Inbox-driven verdicts no longer need this upstream — delivery
        // happens out-of-band via WrapperFrameSender on the click-handling
        // replica (or via the periodic sweep). Closing here is safe.
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.close();
        }
      });

      const upstreamUrl = `ws://${podBaseUrl(instanceId, namespace)}/api/acp`;

      identityLookup.resolve(instanceId)
        .then((resolved) => {
          if (!resolved) {
            client.close(1011, "instance not found");
            throw new Error("instance not found");
          }
          identity = resolved;
        })
        .then(() => repo.ensureReady(instanceId))
        .then(() => connectUpstream(upstreamUrl))
        .then((u) => {
          upstream = u;

          // Client gave up during the dial. Flush any queued messages
          // anyway — the user may have typed a prompt before reloading,
          // and the wrapper handles "channel detached mid-active-prompt"
          // gracefully (session/update notifications still land in its
          // log, so the user catches up on reconnect). Then close the
          // upstream so we don't leak it.
          if (clientClosedDuringDial) {
            if (u.readyState === WebSocket.OPEN) {
              for (const msg of pending) {
                u.send(msg.data, { binary: msg.isBinary });
              }
            }
            pending.length = 0;
            u.close();
            return;
          }

          // `connectUpstream` resolves on the WS `open` event, so this is
          // expected to be true. Guarding instead of silently dropping the
          // pending frames: if for any reason the socket isn't OPEN here,
          // failing the upgrade closed is more honest than draining
          // messages into the void.
          if (u.readyState !== WebSocket.OPEN) {
            client.close(1011, "upstream not ready");
            u.close();
            return;
          }

          repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true")
        .catch(warnOnPatchFailure(`patch ${ACTIVE_SESSION_KEY}=true`));

          for (const msg of pending) {
            u.send(msg.data, { binary: msg.isBinary });
          }
          pending.length = 0;

          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (u.readyState === WebSocket.OPEN) {
              u.send(data, { binary: isBinary });

              if (!isBinary) {
                const parsed = tryParse(data);
                if (isResponse(parsed)) mirrorPermissionResponse(parsed);
              }

              if (shouldUpdateActivity(instanceId)) {
                repo.patchAnnotation(
                  instanceId,
                  LAST_ACTIVITY_KEY, new Date().toISOString(),
                ).catch(warnOnPatchFailure(`patch ${LAST_ACTIVITY_KEY}`));
              }
            }
          });

          u.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(data, { binary: isBinary });

              if (!isBinary) {
                const parsed = tryParse(data);
                if (isPermissionRequest(parsed)) mirrorPermissionRequest(parsed);
              }
            }
          });

          u.on("close", (code, reason) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.close(sanitizeCloseCode(code), reason.toString() || "upstream closed");
              } catch {
                client.terminate();
              }
            }
          });

          u.on("error", () => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.close(1011, "upstream error");
              } catch {
                client.terminate();
              }
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
