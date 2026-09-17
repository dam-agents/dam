import type { RuntimeMutator } from "../services/runtime-mutator.js";

const WORKSPACE_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type OutboxEvent = Parameters<RuntimeMutator["bump"]>[1][number];

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one shape of a workspace-mutating event.
 * Every path that queues a seed or an install — a create, a kit apply, a
 * retry of a failed step — builds it here, so the key and the TTL cannot
 * drift between them; the prefix names the path that queued it, the agent
 * id and the instant keep the key per agent.
 */
export function workspaceEvent(
  kind: OutboxEvent["kind"],
  idPrefix: string,
  agentId: string,
  payload: OutboxEvent["payload"],
  at: Date,
): OutboxEvent {
  return {
    id: `${idPrefix}:${agentId}:${at.getTime()}`,
    kind,
    payload,
    expiresAt: new Date(at.getTime() + WORKSPACE_EVENT_TTL_MS),
  };
}
