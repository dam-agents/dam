import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { agentServiceAddress } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { AGENT_NOT_READY_REASON } from "api-server-api";
import {
  isAgentStoppedError,
  isAgentWakeTimeoutError,
} from "../../../modules/agents/index.js";
import { createActivityStamper } from "./activity-stamper.js";
import type { SessionPresence } from "./session-presence.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { sanitizeCloseCode } from "./acp-relay.js";
import {
  createWakeGatedRelay,
  type WakeGatedRelay,
} from "./wake-gated-relay.js";

const EVICT_CHANNEL = "terminal:evict";

export type TerminalRelay = WakeGatedRelay;

const TERMINAL_LEASE_PARAMS = ["harness", "provider", "model"] as const;

// UNIT_BOUNDARY_DESCRIPTION: the runtime's terminal path for one viewer connection. It carries the Session, a reset, and what a new Session starts with: a harness pair, or `shell=1` for the agent user's login shell, which needs no harness, provider or model. Nothing else the client sent, its token included, reaches the agent.
export function terminalUpstreamPath(query: URLSearchParams): string {
  const upstream = new URLSearchParams({
    sessionId: query.get("sessionId") ?? "default",
  });
  if (query.get("reset") === "1") upstream.set("reset", "1");
  for (const name of TERMINAL_LEASE_PARAMS) {
    const value = query.get(name);
    if (value) upstream.set(name, value);
  }
  if (query.get("shell") === "1") upstream.set("shell", "1");
  return `/api/terminal?${upstream.toString()}`;
}

// UNIT_BOUNDARY_DESCRIPTION: a terminal wakes a hibernated agent, unless its client asks with `wake=0`, as the web app does for a connect of its own rather than the user's: then it only waits out a wake already asked for, so a tab left open does not wake an agent its user just put to sleep. It holds the agent awake only once the agent's end is open, since the hold alone would wake it.
export function createTerminalRelay(
  namespace: string,
  repo: AgentsRepository,
  presence: SessionPresence,
  bus: RedisBus,
  upstreamBase: (agentId: string) => string = (agentId) =>
    `ws://${agentServiceAddress(agentId, namespace)}`,
): TerminalRelay {
  const stamper = createActivityStamper(repo);
  const replicaId = randomUUID();
  const activeClients = new Map<string, WebSocket>();
  const params = (req: IncomingMessage) =>
    new URL(req.url!, `http://${req.headers.host}`).searchParams;
  const clientKey = (agentId: string, req: IncomingMessage) =>
    `${agentId}:${params(req).get("sessionId") ?? "default"}`;

  function evictLocal(key: string, reason: string) {
    const ws = activeClients.get(key);
    activeClients.delete(key);
    if (!ws) return;
    if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    else if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, reason);
      } catch {
        ws.terminate();
      }
    }
  }

  const unsubscribeEvict = bus.subscribe(EVICT_CHANNEL, (payload) => {
    try {
      const { key, from } = JSON.parse(payload) as {
        key: string;
        from: string;
      };
      if (from !== replicaId) evictLocal(key, "superseded");
    } catch {}
  });

  const relay = createWakeGatedRelay({
    repo,
    upstreamBase,
    ensureReady: (agentId, req) =>
      repo.ensureReady(agentId, { waitOnly: params(req).get("wake") === "0" }),
    upstreamPath: (_agentId, req) => terminalUpstreamPath(params(req)),
    refuse: async () => null,
    activity: null,
    holdPresence: { when: "open", port: presence },
    onClient: (client, agentId, req) => {
      const key = clientKey(agentId, req);
      evictLocal(key, "superseded");
      void bus.publish(EVICT_CHANNEL, JSON.stringify({ key, from: replicaId }));
      activeClients.set(key, client);
      client.once("close", () => {
        if (activeClients.get(key) === client) activeClients.delete(key);
      });
    },
    onClientForwarded: (agentId) => stamper.bump(agentId),
    closeOnWakeFailure: (err) => {
      process.stderr.write(
        `[terminal-relay] failed to connect: ${(err as Error)?.message ?? err}\n`,
      );
      if (isAgentWakeTimeoutError(err))
        return `${AGENT_NOT_READY_REASON}: ${err.failure.kind}`;
      if (isAgentStoppedError(err)) return `${AGENT_NOT_READY_REASON}: stopped`;
      return "failed to connect to agent";
    },
    closeOnUpstreamClose: (code, reason) => ({
      code: sanitizeCloseCode(code),
      reason: reason.toString() || "upstream closed",
    }),
    closeOnUpstreamError: (err, opened) => {
      if (opened) return "upstream error";
      process.stderr.write(
        `[terminal-relay] failed to connect: ${err?.message ?? err}\n`,
      );
      return "failed to connect to agent";
    },
  });

  return {
    handleUpgrade: relay.handleUpgrade,
    close() {
      unsubscribeEvict();
      relay.close();
    },
  };
}
