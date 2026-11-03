import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
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

// UNIT_BOUNDARY_DESCRIPTION: a terminal wakes a hibernated agent, unless its client asks with `wake=0`, as the web app does for a connect of its own rather than the user's: then it only waits out a wake already asked for, so a tab left open does not wake an agent its user just put to sleep. It holds the agent awake only once the agent's end is open, since the hold alone would wake it.
export function createTerminalRelay(
  namespace: string,
  repo: AgentsRepository,
  presence: SessionPresence,
  bus: RedisBus,
  upstreamBase: (agentId: string) => string = (agentId) =>
    `ws://${podBaseUrl(agentId, namespace)}`,
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
    upstreamPath: (agentId, req) => {
      const query = params(req);
      const sessionId = query.get("sessionId") ?? "default";
      const reset = query.get("reset") === "1";
      const lease = new URLSearchParams();
      for (const name of ["harness", "provider", "model"]) {
        const value = query.get(name);
        if (value) lease.set(name, value);
      }
      return `/api/terminal?sessionId=${encodeURIComponent(sessionId)}${reset ? "&reset=1" : ""}${lease.size > 0 ? `&${lease.toString()}` : ""}`;
    },
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
      if (isAgentStoppedError(err))
        return `${AGENT_NOT_READY_REASON}: ${err.disabled ? "disabled" : "stopped"}`;
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
