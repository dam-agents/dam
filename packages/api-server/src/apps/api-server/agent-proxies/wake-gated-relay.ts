import { WebSocketServer, WebSocket } from "ws";
import { match } from "ts-pattern";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { isAgentWakeTimeoutError } from "../../../modules/agents/index.js";
import { addUpgradeSecurityHeaders, type RelayActor } from "./upgrade.js";
import { keepAlive } from "./heartbeat.js";
import { readyOrAnswering } from "./ready-or-answering.js";
import type { SessionPresence } from "./session-presence.js";

const DEFAULT_PENDING_BUFFER_MAX_BYTES = 1024 * 1024;

function wakeFailureReason(err: unknown): string {
  return isAgentWakeTimeoutError(err)
    ? `agent not ready: ${err.failure.kind}`
    : "agent unavailable";
}

export type PresenceHold =
  | { when: "none" }
  | { when: "connect" | "open"; port: Pick<SessionPresence, "acquire"> };

export type ClientFrameGate = (
  client: WebSocket,
  data: Buffer,
  isBinary: boolean,
) => Buffer | null;

export interface ActivityTick {
  everyMs: number;
  tick: (agentId: string) => void;
}

export interface WakeGatedRelay {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    agentId: string,
    actor: RelayActor,
  ): void;
  close(): void;
}

export interface WakeGatedRelayOptions {
  repo: Pick<AgentsRepository, "peekCached">;
  upstreamBase: (agentId: string) => string;
  upstreamPath: (agentId: string, req: IncomingMessage) => string;
  ensureReady: (agentId: string, req: IncomingMessage) => Promise<void>;
  bufferMaxBytes?: number;
  refuse: (agentId: string) => Promise<string | null>;
  holdPresence: PresenceHold;
  onClient?: (client: WebSocket, agentId: string, req: IncomingMessage) => void;
  onClientFrame?: (
    client: WebSocket,
    data: Buffer,
    isBinary: boolean,
  ) => boolean;
  onClientForwarded?: (agentId: string) => void;
  clientFrameGate?: (
    agentId: string,
    actor: RelayActor,
  ) => ClientFrameGate | null;
  activity: ActivityTick | null;
  onWoken?: (agentId: string) => void;
  closeOnWakeFailure?: (err: unknown, agentId: string) => string;
  closeOnUpstreamClose?: (
    code: number,
    reason: Buffer,
  ) => { code: number; reason: string };
  closeOnUpstreamError?: (err: Error, opened: boolean) => string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the skeleton every agent relay shares. A client
 * socket is answered with a keep-alive, its frames are held until the agent is
 * ready, and then it is piped to the agent's own socket. The wake wait is a
 * `readyOrAnswering` hold, so a socket held for a hibernated agent opens as
 * soon as the agent answers its health check, and a wake that fails closes the
 * client with the wake's cause. What the client sends before the agent answers
 * is held up to a cap and then refused with 1013, never dropped silently. On
 * shutdown every socket closes with 1001.
 *
 * The relays differ only in what they pass here: the upstream path, whether a
 * hibernated agent nobody asked to wake is refused, whether client traffic
 * stamps activity, how an upstream close reaches the client, what a session
 * hold attaches to, and which client frames an Agent Editor may send.
 */
export function createWakeGatedRelay(
  options: WakeGatedRelayOptions,
): WakeGatedRelay {
  const {
    repo,
    upstreamBase,
    upstreamPath,
    ensureReady,
    bufferMaxBytes = DEFAULT_PENDING_BUFFER_MAX_BYTES,
    refuse,
    holdPresence,
    onClient,
    onClientFrame,
    onClientForwarded,
    clientFrameGate,
    activity,
    onWoken,
    closeOnWakeFailure,
    closeOnUpstreamClose,
    closeOnUpstreamError,
  } = options;

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  addUpgradeSecurityHeaders(wss);

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
    actor: RelayActor,
  ) {
    wss.handleUpgrade(req, socket, head, async (client) => {
      client.on("error", () => {
        try {
          client.terminate();
        } catch {}
      });
      keepAlive(client);
      actor.opened(client);
      onClient?.(client, agentId, req);
      const gate = clientFrameGate?.(agentId, actor) ?? null;

      const holdAtConnect = match(holdPresence)
        .with({ when: "connect" }, (hold) => hold.port)
        .with({ when: "open" }, { when: "none" }, () => null)
        .exhaustive();
      const holdAtOpen = match(holdPresence)
        .with({ when: "open" }, (hold) => hold.port)
        .with({ when: "connect" }, { when: "none" }, () => null)
        .exhaustive();
      let release = holdAtConnect?.acquire(agentId) ?? (() => {});
      const tick = activity
        ? setInterval(() => activity.tick(agentId), activity.everyMs)
        : undefined;

      let upstream: WebSocket | undefined;
      let clientGone = false;
      client.on("close", () => {
        clientGone = true;
        if (tick) clearInterval(tick);
        release();
        closeWs(upstream);
      });

      const pending: [Buffer, boolean][] = [];
      let pendingBytes = 0;
      let overflow = false;
      const buffer = (d: Buffer, b: boolean) => {
        if (overflow) return;
        if (onClientFrame?.(client, d, b)) return;
        const passed = gate ? gate(client, d, b) : d;
        if (passed === null) return;
        pendingBytes += passed.byteLength;
        if (pendingBytes > bufferMaxBytes) {
          overflow = true;
          closeWs(client, 1013, "buffer full");
          return;
        }
        pending.push([passed, b]);
      };
      client.on("message", buffer);

      try {
        const refused = await refuse(agentId);
        if (refused) {
          closeWs(client, 1011, refused);
          return;
        }
        await readyOrAnswering(
          repo,
          agentId,
          ensureReady(agentId, req),
          `${upstreamBase(agentId).replace(/^ws/, "http")}/healthz`,
          () => clientGone,
        );
      } catch (err) {
        closeWs(
          client,
          1011,
          closeOnWakeFailure?.(err, agentId) ?? wakeFailureReason(err),
        );
        return;
      }
      if (clientGone || overflow) return;
      onWoken?.(agentId);

      upstream = new WebSocket(
        `${upstreamBase(agentId)}${upstreamPath(agentId, req)}`,
      );
      const us = upstream;
      let opened = false;
      us.on("open", () => {
        opened = true;
        if (clientGone || overflow) return closeWs(us);
        if (holdAtOpen) release = holdAtOpen.acquire(agentId);
        actor.attached();
        client.off("message", buffer);
        for (const [d, b] of pending) us.send(d, { binary: b });
        pending.length = 0;
        client.on("message", (d: Buffer, isBinary) => {
          if (us.readyState !== WebSocket.OPEN) return;
          const passed = gate ? gate(client, d, isBinary) : d;
          if (passed === null) return;
          us.send(passed, { binary: isBinary });
          onClientForwarded?.(agentId);
        });
        us.on("message", (d, isBinary) => {
          if (client.readyState === WebSocket.OPEN)
            client.send(d, { binary: isBinary });
        });
        us.on("close", (code, reason) => {
          const mapped = closeOnUpstreamClose?.(code, reason);
          closeWs(client, mapped?.code, mapped?.reason);
        });
      });
      us.on("error", (err) => {
        closeWs(us);
        if (client.readyState === WebSocket.OPEN)
          closeWs(
            client,
            1011,
            closeOnUpstreamError?.(err, opened) ?? "agent connection failed",
          );
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
