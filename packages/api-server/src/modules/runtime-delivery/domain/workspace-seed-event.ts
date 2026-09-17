import type { AgentCreateInput } from "api-server-api";

import type { RuntimeMutator } from "../services/runtime-mutator.js";

const SEED_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type OutboxEvent = Parameters<RuntimeMutator["bump"]>[1][number];

export type WorkspaceSeed = NonNullable<AgentCreateInput["gitRepo"]>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: A one-shot seed of the agent's work directory,
 * or its home when the seed says so, from a repository — a create's
 * `gitRepo` or a kit's own definition. Built here so every create path
 * queues the same event shape; the prefix names the path that queued it, so
 * two seeds queued in the same instant keep distinct keys.
 */
export function workspaceSeedEvent(
  idPrefix: string,
  agentId: string,
  seed: WorkspaceSeed,
  at: Date,
): OutboxEvent {
  return {
    id: `${idPrefix}:${agentId}:${at.getTime()}`,
    kind: "workspace-seed",
    payload: seed,
    expiresAt: new Date(at.getTime() + SEED_EVENT_TTL_MS),
  };
}
