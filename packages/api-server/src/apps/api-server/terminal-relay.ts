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

export function createTerminalRelay(
  namespace: string,
  repo: InstancesRepository,
) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const lastActivityTimestamps = new Map<string, number>();

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    const reqUrl = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = reqUrl.searchParams.get("sessionId") ?? "default";
    const reset = reqUrl.searchParams.get("reset") === "1";

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

      const upstreamUrl = `ws://${podBaseUrl(instanceId, namespace)}/api/terminal?sessionId=${encodeURIComponent(sessionId)}${reset ? "&reset=1" : ""}`;

      repo.ensureReady(instanceId)
        .then(() => new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(upstreamUrl);
          ws.on("open", () => resolve(ws));
          ws.on("error", (err) => { ws.close(); reject(err); });
        }))
        .then((upstream) => {
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

              const now = Date.now();
              const last = lastActivityTimestamps.get(instanceId) ?? 0;
              if (now - last >= DEBOUNCE_MS) {
                lastActivityTimestamps.set(instanceId, now);
                repo.patchAnnotation(instanceId, LAST_ACTIVITY_KEY, new Date().toISOString()).catch(() => {});
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
              // Sanitize close code: only pass through valid codes
              const safeCode = (code === 1000 || (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999))
                ? code : 1011;
              try { client.close(safeCode, reason.toString() || "upstream closed"); } catch { client.terminate(); }
            }
          });

          upstream.on("error", () => {
            if (client.readyState === WebSocket.OPEN) {
              try { client.close(1011, "upstream error"); } catch { client.terminate(); }
            }
          });

          client.on("close", () => {
            repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "").catch(() => {});
            if (upstream.readyState === WebSocket.OPEN) upstream.close();
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
