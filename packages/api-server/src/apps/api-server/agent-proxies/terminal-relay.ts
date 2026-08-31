import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { isAgentWakeTimeoutError } from "../../../modules/agents/index.js";
import { LAST_ACTIVITY_KEY } from "../../../modules/agents/infrastructure/labels.js";
import type { SessionPresence } from "./session-presence.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { sanitizeCloseCode } from "./acp-relay.js";
import { boundedSet } from "../../../core/bounded-map.js";

const ACTIVITY_DEBOUNCE_MS = 30_000;
const ACTIVITY_MAP_MAX_ENTRIES = 10_000;
const PENDING_BUFFER_MAX_BYTES = 1 * 1024 * 1024;
const EVICT_CHANNEL = "terminal:evict";

export interface TerminalRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ): void;
  close(): void;
}

export function createTerminalRelay(
  namespace: string,
  repo: AgentsRepository,
  presence: SessionPresence,
  bus: RedisBus,
): TerminalRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const lastActivity = new Map<string, number>();
  const replicaId = randomUUID();
  const activeClients = new Map<string, WebSocket>();
  const clientKey = (agentId: string, sessionId: string) =>
    `${agentId}:${sessionId}`;

  function evictLocal(key: string, reason: string) {
    const ws = activeClients.get(key);
    activeClients.delete(key);
    if (!ws) return;
    if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    else if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, reason);
      } catch {
        ws.terminate();
      }
    }
  }

  const unsubscribeEvict = bus.subscribe(EVICT_CHANNEL, (payload) => {
    try {
      const { key, from } = JSON.parse(payload) as {
        key: string;
        from: string;
      };
      if (from !== replicaId) evictLocal(key, "superseded");
    } catch {}
  });

  async function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ) {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId") ?? "default";
    const reset = url.searchParams.get("reset") === "1";

    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => {
        try {
          client.terminate();
        } catch {}
      });

      const key = clientKey(agentId, sessionId);
      evictLocal(key, "superseded");
      void bus.publish(EVICT_CHANNEL, JSON.stringify({ key, from: replicaId }));
      activeClients.set(key, client);

      const release = presence.acquire(agentId);
      let clientGone = false;
      client.once("close", () => {
        clientGone = true;
        release();
        if (activeClients.get(key) === client) activeClients.delete(key);
      });

      const pending: { data: Buffer; isBinary: boolean }[] = [];
      let pendingBytes = 0;
      let bufferOverflow = false;
      const buffer = (data: Buffer, isBinary: boolean) => {
        if (bufferOverflow) return;
        pendingBytes += data.byteLength;
        if (pendingBytes > PENDING_BUFFER_MAX_BYTES) {
          bufferOverflow = true;
          try {
            client.close(1013, "buffer full");
          } catch {
            client.terminate();
          }
          return;
        }
        pending.push({ data, isBinary });
      };
      client.on("message", buffer);

      repo
        .ensureReady(agentId)
        .then(
          () =>
            new Promise<WebSocket>((resolve, reject) => {
              const ws = new WebSocket(
                `ws://${podBaseUrl(agentId, namespace)}/api/terminal?sessionId=${encodeURIComponent(sessionId)}${reset ? "&reset=1" : ""}`,
              );
              ws.on("open", () => resolve(ws));
              ws.on("error", (err) => {
                ws.close();
                reject(err);
              });
            }),
        )
        .then((upstream) => {
          if (clientGone || bufferOverflow) {
            try {
              upstream.close();
            } catch {}
            return;
          }
          client.off("message", buffer);
          for (const { data, isBinary } of pending)
            upstream.send(data, { binary: isBinary });
          pending.length = 0;

          client.on("message", (data, isBinary) => {
            if (upstream.readyState !== WebSocket.OPEN) return;
            upstream.send(data, { binary: isBinary });

            const now = Date.now();
            if (
              now - (lastActivity.get(agentId) ?? 0) >=
              ACTIVITY_DEBOUNCE_MS
            ) {
              boundedSet(lastActivity, agentId, now, ACTIVITY_MAP_MAX_ENTRIES);
              repo
                .patchAnnotation(
                  agentId,
                  LAST_ACTIVITY_KEY,
                  new Date().toISOString(),
                )
                .catch(() => {});
            }
          });

          upstream.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN)
              client.send(data, { binary: isBinary });
          });

          upstream.on("close", (code, reason) => {
            if (client.readyState !== WebSocket.OPEN) return;
            try {
              client.close(
                sanitizeCloseCode(code),
                reason.toString() || "upstream closed",
              );
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
            if (upstream.readyState === WebSocket.OPEN) upstream.close();
          });
        })
        .catch((err) => {
          process.stderr.write(
            `[terminal-relay] failed to connect: ${err?.message ?? err}\n`,
          );
          const reason = isAgentWakeTimeoutError(err)
            ? `agent not ready: ${err.failure.kind}`
            : "failed to connect to agent";
          client.close(1011, reason);
        });
    });
  }

  return {
    handleUpgrade,
    close() {
      unsubscribeEvict();
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
