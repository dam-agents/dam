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
