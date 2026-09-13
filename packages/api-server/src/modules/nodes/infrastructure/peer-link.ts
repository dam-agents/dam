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
 * A workspace is an agent's whole history, so the export verb is not open to
 * every node that holds a certificate: the caller must be the node the agent
 * has just been assigned to, which is the only node with a reason to fetch it.
 * A certificate proves which node is calling and the record says which node
 * that agent is for, and one node compromised should not be every workspace in
 * the install readable.
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether the certificate on the other end is a
 * node's.
 *
 * One authority signs every certificate in the install, gateways included,
 * because an agent has to trust the gateway its own node hands it. So a
 * verified chain says "minted here" and not "is a node" — and the two verbs
 * behind this link read an agent's workspace and open a connection to its
 * sandbox.
 *
 * TLS already refuses a certificate not issued for client authentication, so a
 * gateway's cannot complete the handshake. This says so in the code rather
 * than resting on it: the name only a node's certificate carries and the usage
 * only a node's is issued for, checked where the reason is written down. It is
 * a second lock on the same door, which is the right number for a door whose
 * key every agent's gateway holds a near-miss of.
 */
const CLIENT_AUTH_OID = "1.3.6.1.5.5.7.3.2";

export function isNodeCertificate(cert: {
  subjectaltname?: string;
  ext_key_usage?: string[];
}): boolean {
  const names = (cert?.subjectaltname ?? "").split(",").map((n) => n.trim());
  return (
    names.includes(`DNS:${PEER_SERVER_NAME}`) &&
    (cert?.ext_key_usage ?? []).includes(CLIENT_AUTH_OID)
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which node is on the other end. Every node's leaf
 * carries its own id beside the name they all share, so the certificate
 * already answers this — what it could not do on its own is say whether that
 * node has any business with the agent it is asking about.
 *
 * A node with two names and neither of them the shared one is not a shape this
 * install issues, so it gets no identity rather than a guessed one.
 */
export function nodeIdFromCertificate(cert: {
  subjectaltname?: string;
}): string | null {
  const names = (cert?.subjectaltname ?? "")
    .split(",")
    .map((n) => n.trim())
    .flatMap((n) => (n.startsWith("DNS:") ? [n.slice(4)] : []))
    .filter((n) => n !== PEER_SERVER_NAME);
  return names.length === 1 ? (names[0] ?? null) : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: How long reaching a peer may take before it
 * counts as unreachable. A node whose peer is gone but whose packets are not
 * refused — a stopped guest, a dropped route — otherwise waits out the
 * kernel's own retry budget, and the sweep reconciles agents one after
 * another, so one unreachable peer holds up every other agent on the node.
 *
 * It bounds reaching the peer, not using it, and is lifted once the peer
 * answers: a relay is idle whenever nobody is typing, and an export of a large
 * workspace is one long quiet read — neither is a stall.
 */
export const PEER_CONNECT_TIMEOUT_MS = 5_000;
const PEER_SERVER_NAME = "platform-node";

export type PeerVerb = "dial" | "export";

export type HeaderRead =
  | { done: false; overflow: boolean }
  | { done: true; verb: PeerVerb; agentId: string; rest: Buffer }
  | { done: true; verb: null; agentId: string; rest: Buffer };

export function readHeader(buffered: Buffer): HeaderRead {
  const split = buffered.indexOf(0x0a);
  if (split < 0) {
    return { done: false, overflow: buffered.length > MAX_HEADER_BYTES };
  }
  const line = buffered.subarray(0, split).toString("utf8").trim();
  const rest = buffered.subarray(split + 1);
  const space = line.indexOf(" ");
  const verb = space < 0 ? "" : line.slice(0, space);
  const agentId = space < 0 ? "" : line.slice(space + 1).trim();
  if (verb !== "dial" && verb !== "export") {
    return { done: true, verb: null, agentId, rest };
  }
  return { done: true, verb, agentId, rest };
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
  mayExport: (agentId: string, toNodeId: string) => Promise<boolean>;
  exportWorkspace: (
    agentId: string,
    out: NodeJS.WritableStream,
  ) => Promise<void>;
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
      if (!isNodeCertificate(socket.getPeerCertificate())) {
        opts.log("peer.rejected", {
          subject: socket.getPeerCertificate()?.subject?.CN,
        });
        return socket.destroy();
      }
      let header = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        header = Buffer.concat([header, chunk]);
        const read = readHeader(header);
        if (!read.done) {
          if (read.overflow) socket.destroy();
          return;
        }
        socket.off("data", onData);
        const { verb, agentId, rest } = read;
        if (verb === null) {
          opts.log("peer.bad-request", { agentId });
          return socket.destroy();
        }
        if (verb === "export") {
          const caller = nodeIdFromCertificate(socket.getPeerCertificate());
          void (async () => {
            if (!caller || !(await opts.mayExport(agentId, caller))) {
              opts.log("peer.export.refused", { agentId, caller });
              socket.destroy();
              return;
            }
            await opts.exportWorkspace(agentId, socket);
          })().catch((err: unknown) => {
            opts.log("peer.export.failed", {
              agentId,
              error: err instanceof Error ? err.message : String(err),
            });
            socket.destroy();
          });
          return;
        }
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

function dialPeer(opts: {
  peerAddress: string;
  credentials: PeerCredentials;
  verb: PeerVerb;
  agentId: string;
  timeoutMs?: number;
  onReady: (socket: Socket) => void;
  onError: (err: Error) => void;
}): void {
  const [host, port] = opts.peerAddress.split(":");
  const socket = tlsConnect(
    {
      host,
      port: Number(port),
      ca: opts.credentials.ca,
      cert: opts.credentials.cert,
      key: opts.credentials.key,
      servername: PEER_SERVER_NAME,
      timeout: opts.timeoutMs ?? PEER_CONNECT_TIMEOUT_MS,
    },
    () => {
      socket.setTimeout(0);
      socket.write(`${opts.verb} ${opts.agentId}\n`);
      opts.onReady(socket);
    },
  );
  socket.once("timeout", () => {
    socket.destroy();
    opts.onError(new Error(`peer ${opts.peerAddress} did not answer in time`));
  });
  socket.once("error", opts.onError);
}

export function openPeerStream(opts: {
  peerAddress: string;
  credentials: PeerCredentials;
  verb: PeerVerb;
  agentId: string;
  timeoutMs?: number;
}): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    dialPeer({ ...opts, onReady: resolve, onError: reject });
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One loopback listener per remote agent, opened at
 * most once however many callers ask at once.
 *
 * Binding a listener takes an await, and the check for one that already exists
 * happens before it — so two callers arriving together both found nothing,
 * both bound, and the second one's bookkeeping erased the first, leaving a
 * listener held open by nothing that could ever close it. Asking is what the
 * change stream does on every status a remote node publishes, which is often.
 * Requests for one agent are therefore run one after another, which makes the
 * check and the bind indivisible without a lock.
 */
export function createPeerTunnels(opts: {
  credentials: PeerCredentials;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): PeerTunnels {
  const open = new Map<
    string,
    { peer: string; address: string; close: () => void }
  >();
  const queue = new Map<string, Promise<unknown>>();

  async function openTunnel(
    agentId: string,
    peerAddress: string,
  ): Promise<string> {
    const existing = open.get(agentId);
    if (existing?.peer === peerAddress) return existing.address;
    existing?.close();

    const server = createServer((downstream) => {
      dialPeer({
        peerAddress,
        credentials: opts.credentials,
        verb: "dial",
        agentId,
        onReady: (up) => splice(downstream, up),
        onError: () => downstream.destroy(),
      });
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
  }

  return {
    ensure(agentId, peerAddress) {
      const after = queue.get(agentId) ?? Promise.resolve();
      const next = after
        .catch(() => {})
        .then(() => openTunnel(agentId, peerAddress));
      const tail = next.catch(() => {});
      queue.set(agentId, tail);
      void tail.then(() => {
        if (queue.get(agentId) === tail) queue.delete(agentId);
      });
      return next;
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
