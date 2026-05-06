/**
 * Terminal WebSocket relay — opaque binary tunnel between client and the
 * agent-runtime's PTY endpoint. No JSON-RPC, no permission mirroring.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { InstancesRepository } from "../../modules/agents/infrastructure/instances-repository.js";
import { LAST_ACTIVITY_KEY, ACTIVE_SESSION_KEY } from "../../modules/agents/infrastructure/labels.js";

const ACTIVITY_DEBOUNCE_MS = 30_000;

// Valid WebSocket close codes per RFC 6455 + 3000-4999 user range. Anything
// else gets coerced to 1011 (server error) — `ws` throws on out-of-range codes.
function safeCloseCode(code: number): number {
  if (code === 1000) return code;
  if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) return code;
  if (code >= 3000 && code <= 4999) return code;
  return 1011;
}

export function createTerminalRelay(namespace: string, repo: InstancesRepository) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const lastActivity = new Map<string, number>();

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, instanceId: string) {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId") ?? "default";
    const reset = url.searchParams.get("reset") === "1";

    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => { try { client.terminate(); } catch {} });

      // Buffer client messages until upstream is open.
      const pending: { data: Buffer; isBinary: boolean }[] = [];
      const buffer = (data: Buffer, isBinary: boolean) => { pending.push({ data, isBinary }); };
      client.on("message", buffer);

      repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

      repo.ensureReady(instanceId)
        .then(() => new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(`ws://${podBaseUrl(instanceId, namespace)}/api/terminal?sessionId=${encodeURIComponent(sessionId)}${reset ? "&reset=1" : ""}`);
          ws.on("open", () => resolve(ws));
          ws.on("error", (err) => { ws.close(); reject(err); });
        }))
        .then((upstream) => {
          client.off("message", buffer);
          for (const { data, isBinary } of pending) upstream.send(data, { binary: isBinary });

          client.on("message", (data, isBinary) => {
            if (upstream.readyState !== WebSocket.OPEN) return;
            upstream.send(data, { binary: isBinary });

            const now = Date.now();
            if (now - (lastActivity.get(instanceId) ?? 0) >= ACTIVITY_DEBOUNCE_MS) {
              lastActivity.set(instanceId, now);
              repo.patchAnnotation(instanceId, LAST_ACTIVITY_KEY, new Date().toISOString()).catch(() => {});
            }
          });

          upstream.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
          });

          upstream.on("close", (code, reason) => {
            if (client.readyState !== WebSocket.OPEN) return;
            try { client.close(safeCloseCode(code), reason.toString() || "upstream closed"); }
            catch { client.terminate(); }
          });

          upstream.on("error", () => {
            if (client.readyState !== WebSocket.OPEN) return;
            try { client.close(1011, "upstream error"); } catch { client.terminate(); }
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
