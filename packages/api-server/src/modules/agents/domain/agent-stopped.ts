export class AgentStoppedError extends Error {
  readonly agentId: string;

  constructor(agentId: string) {
    super(
      `agent ${agentId} was put to sleep by its owner — try again in a moment, or wake it`,
    );
    this.name = "AgentStoppedError";
    this.agentId = agentId;
  }
}

export function isAgentStoppedError(e: unknown): e is AgentStoppedError {
  return e instanceof AgentStoppedError;
}
