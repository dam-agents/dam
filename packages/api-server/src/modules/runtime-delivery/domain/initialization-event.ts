import type { RuntimeMutator } from "../services/runtime-mutator.js";

const INITIALIZATION_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type OutboxEvent = Parameters<RuntimeMutator["bump"]>[1][number];

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
