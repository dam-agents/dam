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

// `-c <dir>` makes the tmux session's start-directory match the cwd that
// agent-runtime hands to ACP (`WORK_DIR`, default `${HOME}/work`). Without
// this the exec lands in the container's `/app` WORKDIR and Claude sees
// a different file tree than the UI session.
//
// We also ship a minimal tmux.conf so Claude renders correctly inside the
// session: `focus-events` (Claude warns when off), 256/true-color terminal
// (default `screen` strips color), and mouse for scrollback. Written to
// `/tmp` per attach so we don't pollute the persistent HOME.
const TMUX_CONF = [
  "set -g focus-events on",
  'set -g default-terminal "tmux-256color"',
  'set -ga terminal-overrides ",*256col*:Tc"',
  "set -g mouse on",
].join("\n");

function tmuxCommand(workDir: string): string[] {
  // LANG/LC_ALL are unset in the agent image; without them tmux uses ASCII
  // width math and Claude's box-drawing/emoji glyphs misalign by a column on
  // every line that contains a wide char. Forcing C.UTF-8 fixes it without
  // pulling in a locale package.
  const script = [
    `export LANG=C.UTF-8 LC_ALL=C.UTF-8`,
    `cat >/tmp/humr-tmux.conf <<'__HUMR_TMUX_CONF__'`,
    TMUX_CONF,
    `__HUMR_TMUX_CONF__`,
    `exec tmux -u -f /tmp/humr-tmux.conf new -A -s humr -c ${JSON.stringify(workDir)} claude`,
  ].join("\n");
  return ["bash", "-c", script];
}

function buildExecPath(namespace: string, podName: string, workDir: string): string {
  const params = new URLSearchParams();
  params.set("stdin", "true");
  params.set("stdout", "true");
  params.set("stderr", "true");
  params.set("tty", "true");
  params.set("container", "agent");
  for (const arg of tmuxCommand(workDir)) params.append("command", arg);
  return `/api/v1/namespaces/${namespace}/pods/${podName}/exec?${params.toString()}`;
}

function podName(instanceId: string): string {
  return `${instanceId}-0`;
}

export function createShellRelay(namespace: string, kc: KubeConfig, workDir: string) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, async (client) => {
      const handler = new WebSocketHandler(kc);
      const path = buildExecPath(namespace, podName(instanceId), workDir);

      // The CLI sends an initial resize the moment the WS opens. Without
      // queueing here, that frame fires before the post-`await` listener is
      // attached and gets dropped — tmux then sticks at its default 80×24
      // until the next SIGWINCH. Buffer everything the client sends until
      // upstream is ready, then drain in order.
      const pending: { data: Buffer; isBinary: boolean }[] = [];
      const bufferOnly = (data: unknown, isBinary: boolean) => {
        const buf = data instanceof Buffer
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[])
            : Buffer.from(data as ArrayBuffer);
        pending.push({ data: buf, isBinary });
      };
      client.on("message", bufferOnly);

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
        // The K8s WS client surfaces upgrade failures as a generic event-shaped
        // object (no .stack), so we pull `message` plus the resolved upstream
        // URL out by hand to make the cause obvious in logs.
        const e = err as { message?: string; target?: { url?: string } };
        process.stderr.write(
          `shell-relay: upstream connect failed for ${instanceId}: ${e.message ?? "(empty error)"} (${e.target?.url ?? ""})\n`,
        );
        try { client.close(1011, "failed to attach to pod"); } catch { client.terminate(); }
        return;
      }

      const forward = (data: Buffer, isBinary: boolean) => {
        if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
        if (isBinary) {
          const out = Buffer.alloc(data.length + 1);
          out.writeInt8(0, 0);
          data.copy(out, 1);
          upstream.send(out);
          return;
        }
        try {
          const msg = JSON.parse(data.toString()) as { type?: string; cols?: number; rows?: number };
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
      };

      client.off("message", bufferOnly);
      for (const m of pending) forward(m.data, m.isBinary);
      pending.length = 0;
      client.on("message", (data, isBinary) => {
        const buf = data instanceof Buffer
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[])
            : Buffer.from(data as ArrayBuffer);
        forward(buf, isBinary);
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
