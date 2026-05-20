import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import net from "node:net";
import type { InstancesRepository } from "../../modules/instances/infrastructure/instances-repository.js";

const EDITOR_PORT = 2222;

export interface EditorRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ): void;
}

export function createEditorRelay(
  namespace: string,
  repo: InstancesRepository,
): EditorRelay {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      client.on("error", () => {
        try {
          client.terminate();
        } catch {}
      });

      const pending: Buffer[] = [];
      const buffer = (data: Buffer) => {
        pending.push(data);
      };
      client.on("message", buffer);

      repo
        .ensureReady(instanceId)
        .then(
          () =>
            new Promise<net.Socket>((resolve, reject) => {
              const host = `${instanceId}-0.${instanceId}.${namespace}.svc`;
              const tcp = net.createConnection(
                { host, port: EDITOR_PORT },
                () => resolve(tcp),
              );
              tcp.once("error", (err) => reject(err));
            }),
        )
        .then((upstream) => {
          client.off("message", buffer);
          for (const data of pending) upstream.write(data);

          client.on("message", (data) => {
            if (!upstream.writable) return;
            upstream.write(data as Buffer);
          });

          upstream.on("data", (data) => {
            if (client.readyState === WebSocket.OPEN)
              client.send(data, { binary: true });
          });

          upstream.on("close", () => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.close(1000, "upstream closed");
              } catch {
                client.terminate();
              }
            }
          });

          upstream.on("error", () => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.close(1011, "upstream error");
              } catch {
                client.terminate();
              }
            }
          });

          client.on("close", () => {
            try {
              upstream.destroy();
            } catch {}
          });
        })
        .catch((err) => {
          process.stderr.write(
            `[editor-relay] failed to connect: ${err?.message ?? err}\n`,
          );
          try {
            client.close(1011, "failed to connect to editor");
          } catch {
            client.terminate();
          }
        });
    });
  }

  return { handleUpgrade };
}
