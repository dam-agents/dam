import { addUpgradeSecurityHeaders } from "./upgrade.js";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { isAgentWakeTimeoutError } from "../../../modules/agents/index.js";
import { createActivityStamper } from "./activity-stamper.js";
import type { SessionPresence } from "./session-presence.js";
import { sanitizeCloseCode } from "./acp-relay.js";

const PENDING_BUFFER_MAX_BYTES = 256 * 1024;
const PING_INTERVAL_MS = 30_000;

export interface BrowserRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ): void;
  close(): void;
}

export async function requiresConnectionAddress(
  repo: Pick<AgentsRepository, "get">,
  agentId: string,
): Promise<boolean> {
  const agent = await repo.get(agentId);
  return agent?.spec.requireConnectionAddress === true;
}

const STREAM_SOCKET_PATH =
  /^\/api\/public\/browser-stream\/[^/]+\/api\/websockets$/;

export function browserUpstreamPath(requestUrl: URL): string {
  return STREAM_SOCKET_PATH.test(requestUrl.pathname)
    ? "/api/browser/display"
    : "/api/browser";
}

export function createBrowserRelay(
  namespace: string,
  repo: Pick<AgentsRepository, "ensureReady" | "patchAnnotation">,
  presence: SessionPresence,
  upstreamBase: (agentId: string) => string = (agentId) =>
    `ws://${podBaseUrl(agentId, namespace)}`,
): BrowserRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  addUpgradeSecurityHeaders(wss);
  const stamper = createActivityStamper(repo);
  const closeWs = (ws?: WebSocket, code?: number, reason?: string) => {
    try {
      ws?.close(code, reason);
    } catch {
      ws?.terminate();
    }
  };

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
  ) {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const display = STREAM_SOCKET_PATH.test(url.pathname);
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
          closeWs(client, 1013, "buffer full");
          return;
        }
        pending.push([d, b]);
      };
      client.on("message", buffer);

      try {
        await repo.ensureReady(agentId);
      } catch (err) {
        const reason = isAgentWakeTimeoutError(err)
          ? `agent not ready: ${err.failure.kind}`
          : "agent unavailable";
        closeWs(client, 1011, reason);
        return;
      }
      if (clientGone || overflow) return;

      upstream = new WebSocket(
        `${upstreamBase(agentId)}${browserUpstreamPath(url)}`,
      );
      const us = upstream;
      us.on("open", () => {
        if (clientGone || overflow) return closeWs(us);
        client.off("message", buffer);
        for (const [d, b] of pending) us.send(d, { binary: b });
        client.on("message", (d, isBinary) => {
          if (us.readyState !== WebSocket.OPEN) return;
          us.send(d, { binary: isBinary });
          if (!display) stamper.bump(agentId);
        });
        us.on("message", (d, isBinary) => {
          if (client.readyState === WebSocket.OPEN)
            client.send(d, { binary: isBinary });
        });
        us.on("close", (code, reason) =>
          closeWs(
            client,
            sanitizeCloseCode(code),
            reason.toString() || "browser closed",
          ),
        );
      });
      us.on("error", () => {
        closeWs(us);
        if (client.readyState === WebSocket.OPEN)
          closeWs(client, 1011, "agent connection failed");
      });
    });
  }

  return {
    handleUpgrade,
    close() {
      for (const client of wss.clients)
        closeWs(client, 1001, "server shutting down");
    },
  };
}
