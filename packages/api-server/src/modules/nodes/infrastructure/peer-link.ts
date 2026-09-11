import { createServer, connect, type Socket } from "node:net";
import {
  createServer as createTlsServer,
  connect as tlsConnect,
} from "node:tls";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: How a node reaches an agent that is running on a
 * different one. Every relay and client in the api-server dials a sandbox by
 * `host:port` and builds its own URL around it, so the way to make a remote
 * agent reachable without touching any of them is to hand out a `host:port`
 * that happens to be local: a loopback listener whose other end is the node
 * that holds the agent.
 *
 * It carries bytes, not requests. HTTP, WebSocket upgrades and the terminal's
 * binary frames all cross it unchanged, and nothing here has to know which it
 * is looking at.
 *
 * The hop between nodes is mutually authenticated TLS against the install's
 * CA, which is the only thing that makes it safe: the traffic on it carries no
 * user credential — the api-server strips those before relaying — so anything
 * that can open the peer port can drive any agent on that node. Both ends
 * present a certificate the install signed and both require one.
 *
 * The server half accepts a connection naming an agent and joins it to that
 * agent's sandbox on this node; the client half hands out one loopback
 * `host:port` per remote agent. The name arrives as one newline-terminated
 * line, which may be split across TCP segments and may share a segment with
 * the request that follows it — so it is read by accumulating rather than by
 * assuming the first chunk holds all of it and nothing else.
 *
 * Ceiling: one loopback listener per remote agent, which is fine for a handful
 * of nodes and would want pooling well before a hundred.
 */
export interface PeerCredentials {
  ca: string;
  cert: string;
  key: string;
}

export async function readPeerCredentials(
  caCertPath: string,
  leafDir: string,
): Promise<PeerCredentials> {
  const [ca, cert, key] = await Promise.all([
    readFile(caCertPath, "utf8"),
    readFile(join(leafDir, "tls.crt"), "utf8"),
    readFile(join(leafDir, "tls.key"), "utf8"),
  ]);
  return { ca, cert, key };
}

export const MAX_HEADER_BYTES = 256;

export type HeaderRead =
  | { done: false; overflow: boolean }
  | { done: true; agentId: string; rest: Buffer };

export function readHeader(buffered: Buffer): HeaderRead {
  const split = buffered.indexOf(0x0a);
  if (split < 0) {
    return { done: false, overflow: buffered.length > MAX_HEADER_BYTES };
  }
  return {
    done: true,
    agentId: buffered.subarray(0, split).toString("utf8").trim(),
    rest: buffered.subarray(split + 1),
  };
}

const splice = (a: Socket, b: Socket) => {
  a.pipe(b);
  b.pipe(a);
  const end = () => {
    a.destroy();
    b.destroy();
  };
  a.on("error", end);
  b.on("error", end);
  a.on("close", end);
  b.on("close", end);
};

export interface PeerServer {
  close(): Promise<void>;
}

export function startPeerServer(opts: {
  port: number;
  credentials: PeerCredentials;
  localAddressOf: (agentId: string) => string | null;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): Promise<PeerServer> {
  const server = createTlsServer(
    {
      ca: opts.credentials.ca,
      cert: opts.credentials.cert,
      key: opts.credentials.key,
      requestCert: true,
      rejectUnauthorized: true,
    },
    (socket) => {
      let header = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        header = Buffer.concat([header, chunk]);
        const read = readHeader(header);
        if (!read.done) {
          if (read.overflow) socket.destroy();
          return;
        }
        socket.off("data", onData);
        const { agentId, rest } = read;
        const target = opts.localAddressOf(agentId);
        if (!target) {
          opts.log("peer.unknown-agent", { agentId });
          return socket.destroy();
        }
        socket.pause();
        const [host, port] = target.split(":");
        const upstream = connect(Number(port), host, () => {
          if (rest.length) upstream.write(rest);
          splice(socket, upstream);
          socket.resume();
        });
        upstream.on("error", () => socket.destroy());
      };
      socket.on("data", onData);
      socket.on("error", () => socket.destroy());
    },
  );

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, () =>
      resolve({
        close: () => new Promise<void>((done) => server.close(() => done())),
      }),
    );
  });
}

export interface PeerTunnels {
  ensure(agentId: string, peerAddress: string): Promise<string>;
  drop(agentId: string): void;
  stop(): Promise<void>;
}

export function createPeerTunnels(opts: {
  credentials: PeerCredentials;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): PeerTunnels {
  const open = new Map<
    string,
    { peer: string; address: string; close: () => void }
  >();

  return {
    async ensure(agentId, peerAddress) {
      const existing = open.get(agentId);
      if (existing?.peer === peerAddress) return existing.address;
      existing?.close();

      const [peerHost, peerPort] = peerAddress.split(":");
      const server = createServer((downstream) => {
        const up = tlsConnect(
          {
            host: peerHost,
            port: Number(peerPort),
            ca: opts.credentials.ca,
            cert: opts.credentials.cert,
            key: opts.credentials.key,
            servername: "platform-node",
          },
          () => {
            up.write(`${agentId}\n`);
            splice(downstream, up);
          },
        );
        up.on("error", () => downstream.destroy());
      });

      const address = await new Promise<string>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const info = server.address();
          resolve(
            typeof info === "object" && info ? `127.0.0.1:${info.port}` : "",
          );
        });
      });

      open.set(agentId, {
        peer: peerAddress,
        address,
        close: () => server.close(),
      });
      opts.log("peer.tunnel.open", { agentId, peer: peerAddress, address });
      return address;
    },

    drop(agentId) {
      const tunnel = open.get(agentId);
      if (!tunnel) return;
      tunnel.close();
      open.delete(agentId);
    },

    async stop() {
      for (const tunnel of open.values()) tunnel.close();
      open.clear();
    },
  };
}
