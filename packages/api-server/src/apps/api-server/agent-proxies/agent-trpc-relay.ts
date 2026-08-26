import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { LAST_ACTIVITY_KEY } from "../../../modules/agents/infrastructure/labels.js";

const PENDING_BUFFER_MAX_BYTES = 1 * 1024 * 1024;
const ACTIVITY_DEBOUNCE_MS = 30_000;
const ACTIVITY_INTERVAL_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

export interface AgentTrpcRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ): void;
}

export function createAgentTrpcRelay(
  namespace: string,
  repo: AgentsRepository,
): AgentTrpcRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const lastActivity = new Map<string, number>();

  const stampNow = (id: string) => {
    lastActivity.set(id, Date.now());
    repo
      .patchAnnotation(id, LAST_ACTIVITY_KEY, new Date().toISOString())
      .catch(() => {});
  };
  const bumpActivity = async (id: string) => {
    if (Date.now() - (lastActivity.get(id) ?? 0) < ACTIVITY_DEBOUNCE_MS) return;
    try {
      const info = await repo.get(id);
      if (!info || !info.ready || info.stopRequested) return;
    } catch {
      return;
    }
    stampNow(id);
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

      const activity = setInterval(
        () => void bumpActivity(agentId),
        ACTIVITY_INTERVAL_MS,
      );

      let upstream: WebSocket | undefined;
      let clientGone = false;
      const closeWs = (ws?: WebSocket) => {
        try {
          ws?.close();
        } catch {}
      };
      client.on("close", () => {
        clearInterval(heartbeat);
        clearInterval(activity);
        clientGone = true;
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
        const info = await repo.get(agentId);
        if (!info || !info.ready || info.stopRequested) {
          client.close(1011, "agent not ready");
          return;
        }
      } catch {
        client.close(1011, "agent unavailable");
        return;
      }
      if (clientGone || overflow) return;
      stampNow(agentId);

      upstream = new WebSocket(
        `ws://${podBaseUrl(agentId, namespace)}/api/trpc-ws`,
      );
      const us = upstream;
      us.on("open", () => {
        if (clientGone || overflow) return closeWs(us);
        client.off("message", buffer);
        for (const [d, b] of pending) us.send(d, { binary: b });
        client.on("message", (d, isBinary) => {
          if (us.readyState !== WebSocket.OPEN) return;
          us.send(d, { binary: isBinary });
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
