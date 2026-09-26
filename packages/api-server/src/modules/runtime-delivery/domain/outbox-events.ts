import type { AgentCreateInput } from "api-server-api";

import type { RuntimeMutator } from "../services/runtime-mutator.js";

const OUTBOX_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type OutboxEvent = Parameters<RuntimeMutator["bump"]>[1][number];

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
    expiresAt: new Date(at.getTime() + OUTBOX_EVENT_TTL_MS),
  };
}

export const workspaceSeedEvent = (
  idPrefix: string,
  agentId: string,
  seed: NonNullable<AgentCreateInput["gitRepo"]>,
  at: Date,
): OutboxEvent => workspaceEvent("workspace-seed", idPrefix, agentId, seed, at);

export const workspaceCommandEvent = (
  idPrefix: string,
  agentId: string,
  command: string,
  at: Date,
): OutboxEvent =>
  workspaceEvent("workspace-command", idPrefix, agentId, { command }, at);

export const initializationEvent = (
  agentId: string,
  task: string,
  at: Date,
): OutboxEvent =>
  workspaceEvent("initialization", "initialization", agentId, { task }, at);
