import type {
  AgentCreateInput,
  SessionPair,
  StartupItemsEventPayload,
} from "api-server-api";

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

export const startupItemsEvent = (
  agentId: string,
  payload: StartupItemsEventPayload,
  at: Date,
): OutboxEvent =>
  workspaceEvent("startup-items", "kit-startup-items", agentId, payload, at);

export function sessionPairFields(
  pair: SessionPair | null | undefined,
): Record<string, unknown> {
  if (!pair) return {};
  return {
    harness: pair.harness,
    ...(pair.provider !== null && { provider: pair.provider }),
    ...(pair.model !== null && { model: pair.model }),
    ...(pair.settings && { settings: pair.settings }),
  };
}

function initializationPayload(
  task: string,
  pair: SessionPair | null | undefined,
): OutboxEvent["payload"] {
  return { task, ...sessionPairFields(pair) };
}

export const initializationEvent = (
  agentId: string,
  task: string,
  at: Date,
  pair?: SessionPair | null,
): OutboxEvent =>
  workspaceEvent(
    "initialization",
    "initialization",
    agentId,
    initializationPayload(task, pair),
    at,
  );

export const kitUpdateEvent = (
  agentId: string,
  task: string,
  at: Date,
  pair?: SessionPair | null,
): OutboxEvent =>
  workspaceEvent(
    "initialization",
    "kit-update",
    agentId,
    initializationPayload(task, pair),
    at,
  );
