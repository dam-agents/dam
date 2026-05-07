/**
 * Terminal WebSocket relay — bidirectional binary tunnel between a browser
 * (or future CLI) client and the agent-runtime's PTY endpoint.
 *
 * Much simpler than the ACP relay: frames are opaque binary, there is no
 * JSON-RPC parsing, and no permission mirroring.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { InstancesRepository } from "../../modules/agents/infrastructure/instances-repository.js";
import { LAST_ACTIVITY_KEY, ACTIVE_SESSION_KEY } from "../../modules/agents/infrastructure/labels.js";

const DEBOUNCE_MS = 30_000;

const lastActivityTimestamps = new Map<string, number>();

function shouldUpdateActivity(instanceId: string): boolean {
  const now = Date.now();
  const last = lastActivityTimestamps.get(instanceId) ?? 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastActivityTimestamps.set(instanceId, now);
  return true;
}

function sanitizeCloseCode(code: number): number {
  if (code === 1000 || (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006)) return code;
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

export function createTerminalRelay(
  namespace: string,
  repo: InstancesRepository,
) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    // Extract sessionId from the client's query string and forward it upstream
    // so the agent-runtime can map each session to its own PTY process.
    const reqUrl = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = reqUrl.searchParams.get("sessionId") ?? "default";

    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => {
        try { client.terminate(); } catch {}
      });

      // Buffer messages while we wake the pod and connect upstream
      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

      const upstreamUrl = `ws://${podBaseUrl(instanceId, namespace)}/api/terminal?sessionId=${encodeURIComponent(sessionId)}`;

      repo.ensureReady(instanceId)
        .then(() => connectUpstream(upstreamUrl))
        .then((upstream) => {
          // Flush buffered messages (usually the initial resize frame)
          for (const msg of pending) {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(msg.data, { binary: msg.isBinary });
            }
          }
          pending.length = 0;

          // Replace buffering listener with transparent relay
          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data, { binary: isBinary });

              if (shouldUpdateActivity(instanceId)) {
                repo.patchAnnotation(
                  instanceId,
                  LAST_ACTIVITY_KEY,
                  new Date().toISOString(),
                ).catch(() => {});
              }
            }
          });

          upstream.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(data, { binary: isBinary });
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
              try { client.close(1011, "upstream error"); } catch { client.terminate(); }
            }
          });

          client.on("close", () => {
            repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "").catch(() => {});
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.close();
            }
          });
        })
        .catch((err) => {
          process.stderr.write(`[terminal-relay] failed to connect: ${err?.message ?? err}\n`);
          client.close(1011, "failed to connect to agent");
        });
    });
  }

  return { handleUpgrade };
}
