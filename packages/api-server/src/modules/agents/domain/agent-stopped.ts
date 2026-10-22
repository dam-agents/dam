export class AgentStoppedError extends Error {
  readonly agentId: string;
  readonly disabled: boolean;

  constructor(agentId: string, disabled = false) {
    super(
      disabled
        ? `agent ${agentId} is disabled by its owner — it does not run until they enable it`
        : `agent ${agentId} was put to sleep by its owner — try again in a moment, or wake it`,
    );
    this.name = "AgentStoppedError";
    this.agentId = agentId;
    this.disabled = disabled;
  }
}

export function isAgentStoppedError(e: unknown): e is AgentStoppedError {
  return e instanceof AgentStoppedError;
}
