import { addUpgradeSecurityHeaders, type RelayActor } from "./upgrade.js";
import { keepAlive } from "./heartbeat.js";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { isAgentWakeTimeoutError } from "../../../modules/agents/index.js";
import { createActivityStamper } from "./activity-stamper.js";
import { readyOrAnswering } from "./ready-or-answering.js";
import type { SessionPresence } from "./session-presence.js";

const PENDING_BUFFER_MAX_BYTES = 1 * 1024 * 1024;

export interface SshRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
    actor: RelayActor,
  ): void;
  close(): void;
}

export function createSshRelay(
  namespace: string,
  repo: AgentsRepository,
  presence: SessionPresence,
): SshRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  addUpgradeSecurityHeaders(wss);
  const stamper = createActivityStamper(repo);
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
      const release = presence.acquire(agentId);

      keepAlive(client);

      let upstream: WebSocket | undefined;
      let clientGone = false;
      const closeWs = (ws?: WebSocket) => {
        try {
          ws?.close();
        } catch {}
      };
      client.on("close", () => {
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
        await readyOrAnswering(
          repo,
          agentId,
          repo.ensureReady(agentId),
          `http://${podBaseUrl(agentId, namespace)}/healthz`,
          () => clientGone,
        );
      } catch (err) {
        const reason = isAgentWakeTimeoutError(err)
          ? `agent not ready: ${err.failure.kind}`
          : "agent unavailable";
        client.close(1011, reason);
        return;
      }
      if (clientGone || overflow) return;

      upstream = new WebSocket(
        `ws://${podBaseUrl(agentId, namespace)}/api/ssh`,
      );
      const us = upstream;
      us.on("open", () => {
        if (clientGone || overflow) return closeWs(us);
        actor.attached();
        client.off("message", buffer);
        for (const [d, b] of pending) us.send(d, { binary: b });
        client.on("message", (d, isBinary) => {
          if (us.readyState !== WebSocket.OPEN) return;
          us.send(d, { binary: isBinary });
          stamper.bump(agentId);
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

  return {
    handleUpgrade,
    close() {
      for (const client of wss.clients) {
        try {
          client.close(1001, "server shutting down");
        } catch {
          client.terminate();
        }
      }
    },
  };
}
