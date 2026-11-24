export class AgentStoppedError extends Error {
  readonly agentId: string;

  constructor(agentId: string) {
    super(
      `agent ${agentId} is stopped right now — try again in a moment, or wake it`,
    );
    this.name = "AgentStoppedError";
    this.agentId = agentId;
  }
}

export function isAgentStoppedError(e: unknown): e is AgentStoppedError {
  return e instanceof AgentStoppedError;
}
