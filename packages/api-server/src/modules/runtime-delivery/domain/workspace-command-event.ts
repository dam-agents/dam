import { type OutboxEvent, workspaceEvent } from "./workspace-event.js";

export function workspaceCommandEvent(
  idPrefix: string,
  agentId: string,
  command: string,
  at: Date,
): OutboxEvent {
  return workspaceEvent(
    "workspace-command",
    idPrefix,
    agentId,
    { command },
    at,
  );
}
