import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { LAST_ACTIVITY_KEY } from "../../modules/agents/infrastructure/labels.js";
import type { SessionPresence } from "./session-presence.js";

const ACTIVITY_DEBOUNCE_MS = 30_000;
const PENDING_BUFFER_MAX_BYTES = 1 * 1024 * 1024;

export interface TerminalRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ): void;
  closeSession(sessionId: string): void;
}

export function createTerminalRelay(
  namespace: string,
  repo: AgentsRepository,
  presence: SessionPresence,
): TerminalRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const lastActivity = new Map<string, number>();
  const activeClients = new Map<string, WebSocket>();

  function closeSession(sessionId: string) {
    const ws = activeClients.get(sessionId);
    if (!ws) {
      activeClients.delete(sessionId);
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    else if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, "session mode changed");
      } catch {
        ws.terminate();
      }
    }
    activeClients.delete(sessionId);
  }

  async function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ) {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId") ?? "default";
    const reset = url.searchParams.get("reset") === "1";

    // Session mode is agent-owned metadata; the PTY runs the harness
    // TUI against this session id regardless. The UI confirms the mode switch.

    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => {
        try {
          client.terminate();
        } catch {}
      });

      const prev = activeClients.get(sessionId);
      if (prev) {
        if (prev.readyState === WebSocket.CONNECTING) prev.terminate();
        else if (prev.readyState === WebSocket.OPEN) {
          try {
            prev.close(1000, "superseded");
          } catch {
            prev.terminate();
          }
        }
      }
      activeClients.set(sessionId, client);

      const release = presence.acquire(agentId);
      client.once("close", release);

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
          if (bufferOverflow) {
            try {
              upstream.close();
            } catch {}
            return;
          }
          client.off("message", buffer);
          for (const { data, isBinary } of pending)
            upstream.send(data, { binary: isBinary });

          client.on("message", (data, isBinary) => {
            if (upstream.readyState !== WebSocket.OPEN) return;
            upstream.send(data, { binary: isBinary });

            const now = Date.now();
            if (
              now - (lastActivity.get(agentId) ?? 0) >=
              ACTIVITY_DEBOUNCE_MS
            ) {
              lastActivity.set(agentId, now);
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
              client.close(code, reason.toString() || "upstream closed");
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
            if (activeClients.get(sessionId) === client)
              activeClients.delete(sessionId);
            if (upstream.readyState === WebSocket.OPEN) upstream.close();
          });
        })
        .catch((err) => {
          process.stderr.write(
            `[terminal-relay] failed to connect: ${err?.message ?? err}\n`,
          );
          client.close(1011, "failed to connect to agent");
        });
    });
  }

  return { handleUpgrade, closeSession };
}
