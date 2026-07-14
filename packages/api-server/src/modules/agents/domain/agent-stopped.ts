/** Thrown by `ensureReady` when the agent carries a pending hard stop
 *  (#1900). Deliberately NOT a wake failure: the agent is not failing to
 *  start — its owner told it to stop, and background activity (UI polling,
 *  relay reconnects) must not resurrect it. Only an explicit wake or a
 *  schedule fire clears the stop. */
export class AgentStoppedError extends Error {
  readonly agentId: string;

  constructor(agentId: string) {
    super(`agent ${agentId} was stopped by its owner — wake it to continue`);
    this.name = "AgentStoppedError";
    this.agentId = agentId;
  }
}

export function isAgentStoppedError(e: unknown): e is AgentStoppedError {
  return e instanceof AgentStoppedError;
}
