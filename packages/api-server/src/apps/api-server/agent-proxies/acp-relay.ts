import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { agentServiceAddress } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { isAgentWakeTimeoutError } from "../../../modules/agents/index.js";
import { createActivityStamper } from "./activity-stamper.js";
import { readyOrAnswering } from "./ready-or-answering.js";
import type { ApprovalsRelayService } from "../../../modules/approvals/compose.js";
import {
  acpNativeRowId,
  isRequest,
  isResponse,
  parseFrame,
  recordedOptionsOf,
  recordedToolOf,
  type JsonRpcFrame,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "api-server-api";
import type { SessionPresence } from "./session-presence.js";
import { addUpgradeSecurityHeaders, type RelayActor } from "./upgrade.js";
import { keepAlive } from "./heartbeat.js";
import { emit, EventType } from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import type { FirePair } from "../../../modules/harness-config/index.js";
import { fillSavedDefault } from "./saved-default.js";

const PENDING_BUFFER_MAX_BYTES = 1 * 1024 * 1024;

interface RelayParams {
  sessionId?: string;
  options?: { optionId: string; kind?: string }[];
  toolCall?: { toolCallId?: string; title?: string; rawInput?: unknown };
  _meta?: { platform?: { initiator?: string; harness?: unknown } };
}

function tryParse(data: unknown): JsonRpcFrame | null {
  try {
    return parseFrame(
      typeof data === "string" ? data : (data as Buffer).toString("utf-8"),
    );
  } catch {
    return null;
  }
}

export function sanitizeCloseCode(code: number): number {
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

export function createAcpRelay(
  namespace: string,
  repo: AgentsRepository,
  approvals: ApprovalsRelayService,
  presence: SessionPresence,
  firePair: FirePair,
) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  addUpgradeSecurityHeaders(wss);
  const stamper = createActivityStamper(repo);

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
    actor: RelayActor,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => {
        try {
          client.terminate();
        } catch {}
      });
      keepAlive(client);
      actor.opened(client);

      const passive =
        new URL(req.url ?? "", "http://localhost").searchParams.get(
          "passive",
        ) === "1";

      let identity: { owner: string; agentId: string } | null = null;

      const mirroredRows = new Map<string, string>();

      const unsubInjects = approvals.subscribeFrameInjects(agentId, (frame) => {
        if (client.readyState === WebSocket.OPEN) client.send(frame);
      });
      client.once("close", () => {
        unsubInjects();
        mirroredRows.clear();
      });

      function mirrorPermissionRequest(msg: JsonRpcRequest<RelayParams>): void {
        const params = msg.params;
        const sessionId = params?.sessionId;
        if (!params || !sessionId || !identity) return;
        const tc = params.toolCall ?? {};
        const { toolName, toolCallId } = recordedToolOf(tc);
        const options = recordedOptionsOf(params.options);
        const key = String(msg.id);
        mirroredRows.set(
          key,
          acpNativeRowId(identity.agentId, sessionId, msg.id),
        );
        approvals
          .recordAcpNativePending({
            agentId: identity.agentId,
            sessionId,
            rpcId: msg.id,
            ownerSub: identity.owner,
            toolName,
            ...(toolCallId !== undefined && { toolCallId }),
            args: tc.rawInput,
            idsWhole: true,
            options,
          })
          .then((recorded) => {
            if (!recorded) mirroredRows.delete(key);
          })
          .catch(() => mirroredRows.delete(key));
      }

      function trackIfPrompt(parsed: unknown): void {
        if (
          !isRequest<RelayParams>(parsed) ||
          parsed.method !== "session/prompt"
        )
          return;
        if (
          actor.surface === "ui" &&
          parsed.params?._meta?.platform?.initiator === "system"
        )
          return;
        const harness = parsed.params?._meta?.platform?.harness;
        emit({
          type: EventType.SessionTurnRelayed,
          agentId,
          actorSub: actor.sub,
          surface: actor.surface,
          ...(typeof harness === "string" && { harness }),
        });
      }

      function answeredForEditor(parsed: unknown): boolean {
        if (
          !actor.editor ||
          !isRequest(parsed) ||
          parsed.method !== "platform/markSeen"
        )
          return false;
        client.send(
          JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }),
        );
        return true;
      }

      function mirrorPermissionResponse(msg: JsonRpcResponse): void {
        if (typeof msg.id !== "string" && typeof msg.id !== "number") return;
        const key = String(msg.id);
        const rowId = mirroredRows.get(key);
        const result = msg.result as
          { outcome?: { outcome?: unknown; optionId?: unknown } } | undefined;
        if (!rowId || typeof result?.outcome?.outcome !== "string") return;
        approvals
          .resolveAcpNativeFromInSession(rowId, result.outcome, {
            decidedBy: actor.sub,
          })
          .then(() => mirroredRows.delete(key))
          .catch(() => {});
      }

      const release = passive ? () => {} : presence.acquire(agentId);
      client.once("close", release);

      const pending: {
        data: Buffer | ArrayBuffer | Buffer[];
        isBinary: boolean;
      }[] = [];
      let pendingBytes = 0;
      client.on("message", (data, isBinary) => {
        pendingBytes += (data as Buffer).byteLength ?? 0;
        if (pendingBytes > PENDING_BUFFER_MAX_BYTES) {
          try {
            client.close(1013, "buffer full");
          } catch {
            client.terminate();
          }
          return;
        }
        pending.push({ data: data as Buffer, isBinary });
      });

      let clientGone = false;
      client.once("close", () => {
        clientGone = true;
        pending.length = 0;
      });

      const upstreamQuery = new URLSearchParams();
      if (passive) upstreamQuery.set("passive", "1");
      if (actor.editor) upstreamQuery.set("seen", "0");
      const upstreamUrl = `ws://${agentServiceAddress(agentId, namespace)}/api/acp${
        upstreamQuery.size > 0 ? `?${upstreamQuery.toString()}` : ""
      }`;

      repo
        .resolveIdentity(agentId)
        .then((resolved) => {
          if (!resolved) {
            client.close(1011, "instance not found");
            throw new Error("instance not found");
          }
          identity = resolved;
        })
        .then(async () => {
          if (passive) {
            if (!(await repo.isReady(agentId))) {
              client.close(1011, "agent not ready");
              throw new Error("agent not ready");
            }
            return;
          }
          await readyOrAnswering(
            repo,
            agentId,
            repo.ensureReady(agentId),
            `http://${agentServiceAddress(agentId, namespace)}/healthz`,
            () => clientGone,
          );
        })
        .then(() => connectUpstream(upstreamUrl))
        .then((upstream) => {
          if (clientGone) {
            upstream.close(1000, "client gone");
            return;
          }
          actor.attached();

          let held: Promise<void> | null = null;
          const send = (
            data: Buffer | ArrayBuffer | Buffer[] | string,
            isBinary: boolean,
          ) => {
            if (upstream.readyState === WebSocket.OPEN)
              upstream.send(data, { binary: isBinary });
          };
          const forward = (
            data: Buffer | ArrayBuffer | Buffer[],
            isBinary: boolean,
            parsed: unknown,
          ) => {
            const filled = isBinary
              ? null
              : fillSavedDefault(parsed, agentId, firePair)?.catch(
                  (err: unknown) => {
                    getLogger().warn(
                      { err, agentId },
                      "acp relay: saved default lookup failed",
                    );
                    return null;
                  },
                );
            if (!filled && !held) {
              send(data, isBinary);
              return;
            }
            const before = held ?? Promise.resolve();
            const sent = before
              .then(async () => {
                const frame = await filled;
                send(frame ? JSON.stringify(frame) : data, isBinary);
              })
              .catch((err: unknown) => {
                getLogger().warn(
                  { err, agentId },
                  "acp relay: a held frame could not be sent",
                );
              });
            held = sent;
            void sent.then(() => {
              if (held === sent) held = null;
            });
          };

          for (const msg of pending) {
            const parsed = msg.isBinary ? null : tryParse(msg.data);
            if (answeredForEditor(parsed)) continue;
            if (parsed !== null) trackIfPrompt(parsed);
            forward(msg.data, msg.isBinary, parsed);
          }
          pending.length = 0;

          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (upstream.readyState !== WebSocket.OPEN) return;

            const parsed = isBinary ? null : tryParse(data);
            if (answeredForEditor(parsed)) return;
            if (parsed !== null) trackIfPrompt(parsed);

            if (!passive) stamper.bump(agentId);

            forward(data, isBinary, parsed);
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
            if (
              isRequest<RelayParams>(parsed) &&
              parsed.method === "session/request_permission"
            )
              mirrorPermissionRequest(parsed);
          });

          upstream.on("close", (code, reason) => {
            if (client.readyState !== WebSocket.OPEN) return;
            try {
              client.close(sanitizeCloseCode(code), reason.toString());
            } catch {
              client.terminate();
            }
          });

          upstream.on("error", () => {
            if (client.readyState !== WebSocket.OPEN) return;
            try {
              client.close(1011, "upstream error");
            } catch {
              client.terminate();
            }
          });

          client.on("close", () => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.close();
            }
          });
        })
        .catch((err: unknown) => {
          if (client.readyState !== WebSocket.OPEN) return;
          try {
            const reason = isAgentWakeTimeoutError(err)
              ? `agent not ready: ${err.failure.kind}`
              : "failed to connect to agent";
            client.close(1011, reason);
          } catch {}
        });
    });
  }

  return {
    handleUpgrade,
    close() {
      for (const client of wss.clients) {
        try {
          client.close(1001, "server shutting down");
        } catch {
          client.terminate();
        }
      }
    },
  };
}
