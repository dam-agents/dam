import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import {
  LAST_ACTIVITY_KEY,
  ACTIVE_SESSION_KEY,
} from "../../modules/agents/infrastructure/labels.js";

const PENDING_BUFFER_MAX_BYTES = 1 * 1024 * 1024;
const ACTIVITY_DEBOUNCE_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

export interface SshRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ): void;
}

export function createSshRelay(
  namespace: string,
  repo: AgentsRepository,
): SshRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const open = new Map<string, number>();
  const mark = (id: string, delta: number) => {
    const before = open.get(id) ?? 0;
    const n = before + delta;
    if (n > 0) open.set(id, n);
    else open.delete(id);
    if (before === 0 || n === 0)
      repo
        .patchAnnotation(id, ACTIVE_SESSION_KEY, n > 0 ? "true" : "")
        .catch(() => {});
  };
  const lastActivity = new Map<string, number>();
  const bumpActivity = (id: string) => {
    const now = Date.now();
    if (now - (lastActivity.get(id) ?? 0) >= ACTIVITY_DEBOUNCE_MS) {
      lastActivity.set(id, now);
      repo
        .patchAnnotation(id, LAST_ACTIVITY_KEY, new Date().toISOString())
        .catch(() => {});
    }
  };
  const pipe = (from: WebSocket, to: WebSocket) =>
    from.on(
      "message",
      (d, isBinary) =>
        to.readyState === WebSocket.OPEN && to.send(d, { binary: isBinary }),
    );

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ) {
    wss.handleUpgrade(req, socket, head, async (client) => {
      client.on("error", () => client.terminate());
      mark(agentId, 1);

      // WS liveness: a half-open client (network drop with no clean close)
      // would otherwise hold its active-session pin forever, since `mark(-1)`
      // only runs on 'close'. Ping each interval; if the previous ping went
      // unanswered, terminate — that fires 'close' below, releasing the pin.
      let alive = true;
      client.on("pong", () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) {
          client.terminate();
          return;
        }
        alive = false;
        try {
          client.ping();
        } catch {}
      }, PING_INTERVAL_MS);

      let upstream: WebSocket | undefined;
      let clientGone = false;
      const closeWs = (ws?: WebSocket) => {
        try {
          ws?.close();
        } catch {}
      };
      client.on("close", () => {
        clearInterval(heartbeat);
        clientGone = true;
        mark(agentId, -1);
        closeWs(upstream);
      });

      const pending: [Buffer, boolean][] = [];
      let pendingBytes = 0;
      let overflow = false;
      const buffer = (d: Buffer, b: boolean) => {
        if (overflow) return;
        pendingBytes += d.byteLength;
        if (pendingBytes > PENDING_BUFFER_MAX_BYTES) {
          overflow = true;
          try {
            client.close(1013, "buffer full");
          } catch {
            client.terminate();
          }
          return;
        }
        pending.push([d, b]);
      };
      client.on("message", buffer);

      try {
        await repo.ensureReady(agentId);
      } catch {
        client.close(1011, "agent unavailable");
        return;
      }
      if (clientGone || overflow) return;

      upstream = new WebSocket(
        `ws://${podBaseUrl(agentId, namespace)}/api/ssh`,
      );
      const us = upstream;
      us.on("open", () => {
        if (clientGone || overflow) return closeWs(us);
        client.off("message", buffer);
        for (const [d, b] of pending) us.send(d, { binary: b });
        client.on("message", (d, isBinary) => {
          if (us.readyState !== WebSocket.OPEN) return;
          us.send(d, { binary: isBinary });
          bumpActivity(agentId);
        });
        pipe(us, client);
        us.on("close", () => closeWs(client));
      });
      us.on("error", () => {
        closeWs(us);
        if (client.readyState === WebSocket.OPEN)
          client.close(1011, "agent connection failed");
      });
    });
  }

  return { handleUpgrade };
}
