/**
 * UNIT_BOUNDARY_DESCRIPTION: a recorded rename of one of the owner's Agents, made
 * to free the assistant's reserved name. It is `done` only once the Agent carries
 * the new name; the notice waits for that.
 */
export interface AssistantRename {
  agentId: string;
  from: string;
  to: string;
  done: boolean;
}
