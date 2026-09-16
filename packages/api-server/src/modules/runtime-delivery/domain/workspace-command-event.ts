import type { RuntimeMutator } from "../services/runtime-mutator.js";

const INSTALL_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type OutboxEvent = Parameters<RuntimeMutator["bump"]>[1][number];

/**
 * UNIT_BOUNDARY_DESCRIPTION: A one-shot shell command for the agent's
 * workspace — a kit's or a kinded create's install bootstrap. Built here so
 * every create path queues the same event shape; the prefix names the path
 * that queued it, the agent id keeps the key per agent.
 */
export function workspaceCommandEvent(
  idPrefix: string,
  agentId: string,
  command: string,
  at: Date,
): OutboxEvent {
  return {
    id: `${idPrefix}:${agentId}:${at.getTime()}`,
    kind: "workspace-command",
    payload: { command },
    expiresAt: new Date(at.getTime() + INSTALL_EVENT_TTL_MS),
  };
}
