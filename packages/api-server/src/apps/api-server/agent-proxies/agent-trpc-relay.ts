import { addUpgradeSecurityHeaders, type RelayActor } from "./upgrade.js";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import {
  agentStreamable,
  isAgentStoppedError,
  isAgentWakeTimeoutError,
} from "../../../modules/agents/index.js";
import { createActivityStamper } from "./activity-stamper.js";

const PENDING_BUFFER_MAX_BYTES = 1 * 1024 * 1024;
const ACTIVITY_INTERVAL_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

export interface AgentTrpcRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
    actor: RelayActor,
  ): void;
}

// UNIT_BOUNDARY_DESCRIPTION: the tRPC client's keep-alive ping. While the relay holds a socket for a waking agent it answers the ping itself, so the client does not drop and redial a socket that is only waiting.
const KEEPALIVE_PING = "PING";
const KEEPALIVE_PONG = "PONG";

function wakeFailureReason(err: unknown): string {
  if (isAgentWakeTimeoutError(err))
    return `agent not ready: ${err.failure.kind}`;
  if (isAgentStoppedError(err)) return "agent not ready";
  return "agent unavailable";
}

export function createAgentTrpcRelay(
  namespace: string,
  repo: Pick<AgentsRepository, "get" | "ensureReady" | "patchAnnotation">,
  upstreamBase: (agentId: string) => string = (agentId) =>
    `ws://${podBaseUrl(agentId, namespace)}`,
): AgentTrpcRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  addUpgradeSecurityHeaders(wss);
  const stamper = createActivityStamper(repo);

  const bumpActivity = async (id: string) => {
    if (!stamper.isDue(id)) return;
    try {
      if (!agentStreamable(await repo.get(id))) return;
    } catch {
      return;
    }
    stamper.stamp(id);
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
    actor: RelayActor,
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
        if (!b && d.toString() === KEEPALIVE_PING) {
          client.send(KEEPALIVE_PONG);
          return;
        }
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
        const agent = await repo.get(agentId);
        if (!agent || (agent.hibernated && !agent.wakeRequested)) {
          client.close(1011, "agent not ready");
          return;
        }
        await repo.ensureReady(agentId);
      } catch (err) {
        if (client.readyState === WebSocket.OPEN)
          client.close(1011, wakeFailureReason(err));
        return;
      }
      if (clientGone || overflow) return;
      stamper.stamp(agentId);

      upstream = new WebSocket(`${upstreamBase(agentId)}/api/trpc-ws`);
      const us = upstream;
      us.on("open", () => {
        if (clientGone || overflow) return closeWs(us);
        actor.attached();
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
