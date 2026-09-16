import type { RuntimeMutator } from "../services/runtime-mutator.js";

const INITIALIZATION_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type OutboxEvent = Parameters<RuntimeMutator["bump"]>[1][number];

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one initialization event an agent gets — the
 * first chat session the platform opens for it, carrying the turn composed at
 * create. Every create path that wants one builds it here, so the id is one
 * key per agent and the rail's per-key ledger keeps it to a single session
 * whichever path enqueued it.
 */
export function initializationEvent(
  agentId: string,
  task: string,
  at: Date,
): OutboxEvent {
  return {
    id: `initialization:${agentId}:${at.getTime()}`,
    kind: "initialization",
    payload: { task },
    expiresAt: new Date(at.getTime() + INITIALIZATION_EVENT_TTL_MS),
  };
}
