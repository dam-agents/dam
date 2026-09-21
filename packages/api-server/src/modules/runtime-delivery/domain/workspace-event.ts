import type { RuntimeMutator } from "../services/runtime-mutator.js";

const WORKSPACE_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type OutboxEvent = Parameters<RuntimeMutator["bump"]>[1][number];

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
