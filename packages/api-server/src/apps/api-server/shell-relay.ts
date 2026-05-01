/**
 * POC shell relay (dam-wn6) — `/api/instances/:id/shell`.
 *
 * Bridges a client WebSocket to a Kubernetes pod-exec WebSocket with a TTY,
 * running `tmux new -A -s humr claude` inside the `agent` container. tmux's
 * `-A` flag attaches to the named session if it exists, so reconnects land
 * back in the same TUI for free.
 *
 * Frame protocol:
 *   client → relay (binary)  → stdin bytes (channel 0) to pod
 *   client → relay (text)    → JSON `{type:"resize", cols, rows}` → resize
 *                              channel 4 with `{Height, Width}` payload
 *   pod    → relay (channel 1, 2) → binary frame to client
 */
import type { KubeConfig } from "@kubernetes/client-node";
// `WebSocketHandler` exists in the package but isn't re-exported from the
// barrel — deep import lets us drive the K8s exec WS frame-protocol directly
// (one byte channel prefix) without dragging Node streams into the bridge.
import { WebSocketHandler } from "@kubernetes/client-node/dist/web-socket-handler.js";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";

const TMUX_COMMAND = ["tmux", "new", "-A", "-s", "humr", "claude"];

function buildExecPath(namespace: string, podName: string): string {
  const params = new URLSearchParams();
  params.set("stdin", "true");
  params.set("stdout", "true");
  params.set("stderr", "true");
  params.set("tty", "true");
  params.set("container", "agent");
  for (const arg of TMUX_COMMAND) params.append("command", arg);
  return `/api/v1/namespaces/${namespace}/pods/${podName}/exec?${params.toString()}`;
}

function podName(instanceId: string): string {
  return `${instanceId}-0`;
}

export function createShellRelay(namespace: string, kc: KubeConfig) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, async (client) => {
      const handler = new WebSocketHandler(kc);
      const path = buildExecPath(namespace, podName(instanceId));

      let upstream: WebSocket | undefined;
      try {
        upstream = (await handler.connect(
          path,
          null,
          (streamNum: number, buff: Buffer): boolean => {
            // 1 = stdout, 2 = stderr — both go to the client as binary frames
            if ((streamNum === 1 || streamNum === 2) && client.readyState === WebSocket.OPEN) {
              client.send(buff, { binary: true });
            }
            // 3 = status, 255 = close — stop forwarding
            return streamNum !== 3 && streamNum !== 255;
          },
        )) as unknown as WebSocket;
      } catch (err) {
        process.stderr.write(`shell-relay: upstream connect failed for ${instanceId}: ${err}\n`);
        try { client.close(1011, "failed to attach to pod"); } catch { client.terminate(); }
        return;
      }

      client.on("message", (data, isBinary) => {
        if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
        if (isBinary) {
          const buf = data instanceof Buffer
            ? data
            : Buffer.isBuffer(data)
              ? data
              : Array.isArray(data)
                ? Buffer.concat(data)
                : Buffer.from(data as ArrayBuffer);
          const out = Buffer.alloc(buf.length + 1);
          out.writeInt8(0, 0);
          buf.copy(out, 1);
          upstream.send(out);
          return;
        }
        const text = data.toString();
        try {
          const msg = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
          if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            const payload = JSON.stringify({ Height: msg.rows, Width: msg.cols });
            const body = Buffer.from(payload, "utf8");
            const out = Buffer.alloc(body.length + 1);
            out.writeInt8(4, 0);
            body.copy(out, 1);
            upstream.send(out);
          }
        } catch {
          // Ignore malformed control frames in the POC
        }
      });

      client.on("close", () => {
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          try { upstream.close(); } catch { /* noop */ }
        }
      });

      upstream.on("close", () => {
        if (client.readyState === WebSocket.OPEN) {
          try { client.close(1000, "session ended"); } catch { client.terminate(); }
        }
      });

      upstream.on("error", (err) => {
        process.stderr.write(`shell-relay: upstream error for ${instanceId}: ${err}\n`);
        if (client.readyState === WebSocket.OPEN) {
          try { client.close(1011, "upstream error"); } catch { client.terminate(); }
        }
      });
    });
  }

  return { handleUpgrade };
}
