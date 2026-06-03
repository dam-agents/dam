import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import { ACTIVE_SESSION_KEY } from "../../modules/agents/infrastructure/labels.js";

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
    const n = (open.get(id) ?? 0) + delta;
    if (n > 0) open.set(id, n);
    else open.delete(id);
    if (n === delta || n === 0)
      repo
        .patchAnnotation(id, ACTIVE_SESSION_KEY, n > 0 ? "true" : "")
        .catch(() => {});
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
      client.on("close", () => mark(agentId, -1));

      const pending: [Buffer, boolean][] = [];
      const buffer = (d: Buffer, b: boolean) => pending.push([d, b]);
      client.on("message", buffer);

      try {
        await repo.ensureReady(agentId);
      } catch {
        client.close(1011, "agent unavailable");
        return;
      }

      const upstream = new WebSocket(
        `ws://${podBaseUrl(agentId, namespace)}/api/ssh`,
      );
      const close = (ws: WebSocket) => () => {
        try {
          ws.close();
        } catch {}
      };
      upstream.on("open", () => {
        client.off("message", buffer);
        for (const [d, b] of pending) upstream.send(d, { binary: b });
        pipe(client, upstream);
        pipe(upstream, client);
        client.on("close", close(upstream));
        upstream.on("close", close(client));
      });
      upstream.on("error", () => client.close(1011, "agent connection failed"));
    });
  }

  return { handleUpgrade };
}
