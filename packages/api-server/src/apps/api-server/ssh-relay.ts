import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { LAST_ACTIVITY_KEY } from "../../modules/agents/infrastructure/labels.js";
import type { SessionPresence } from "./session-presence.js";

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
  presence: SessionPresence,
): SshRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
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
      const release = presence.acquire(agentId);

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
        release();
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
