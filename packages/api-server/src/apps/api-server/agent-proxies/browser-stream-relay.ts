import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import type { SessionPresence } from "./session-presence.js";
import { sanitizeCloseCode } from "./acp-relay.js";
import {
  createWakeGatedRelay,
  type WakeGatedRelay,
} from "./wake-gated-relay.js";

const PENDING_BUFFER_MAX_BYTES = 256 * 1024;

export type BrowserStreamRelay = WakeGatedRelay;

export async function requiresConnectionAddress(
  repo: Pick<AgentsRepository, "get">,
  agentId: string,
): Promise<boolean> {
  const agent = await repo.get(agentId);
  return agent?.spec.requireConnectionAddress === true;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: relays the browser panel's stream socket — the
 * one Selkies' web client opens beside its page — to `upstreamPath` on the
 * agent the route named, untouched in both directions. The web client opens
 * it again by itself whenever it closes, so it never wakes a hibernated
 * agent: it waits out a wake something deliberate asked for, and is refused
 * otherwise, or a panel left open would wake an agent its user just put to
 * sleep. It holds the agent awake like any panel, but only once the agent's
 * end is open, since the hold alone would wake it. The stream's own traffic,
 * which acknowledges frames many times a second, never counts as activity.
 * What the client sends before the agent answers is held, up to a cap.
 */
export function createBrowserStreamRelay(
  namespace: string,
  repo: Pick<AgentsRepository, "ensureReady" | "peekCached">,
  presence: SessionPresence,
  upstreamPath: string,
  upstreamBase: (agentId: string) => string = (agentId) =>
    `ws://${podBaseUrl(agentId, namespace)}`,
): BrowserStreamRelay {
  return createWakeGatedRelay({
    repo,
    upstreamBase,
    upstreamPath: () => upstreamPath,
    ensureReady: (agentId) => repo.ensureReady(agentId, { waitOnly: true }),
    bufferMaxBytes: PENDING_BUFFER_MAX_BYTES,
    holdPresence: { fromOpen: presence },
    closeOnUpstreamClose: (code, reason) => ({
      code: sanitizeCloseCode(code),
      reason: reason.toString() || "browser stream closed",
    }),
  });
}
