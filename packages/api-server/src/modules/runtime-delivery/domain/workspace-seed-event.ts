import type { AgentCreateInput } from "api-server-api";

import { type OutboxEvent, workspaceEvent } from "./workspace-event.js";

export type WorkspaceSeed = NonNullable<AgentCreateInput["gitRepo"]>;

export function workspaceSeedEvent(
  idPrefix: string,
  agentId: string,
  seed: WorkspaceSeed,
  at: Date,
): OutboxEvent {
  return workspaceEvent("workspace-seed", idPrefix, agentId, seed, at);
}
