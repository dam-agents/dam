import type { RuntimeMutator } from "../../runtime-delivery/index.js";

const EXECUTE_EVENT_TTL_MS = 3600 * 1000;

export function createExecuteLauncher(deps: {
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
}) {
  return {
    async launch(input: {
      agentId: string;
      experimentId: string;
      task: string;
    }): Promise<void> {
      const { agentId, experimentId, task } = input;
      const eventId = `experiment:${experimentId}:${Date.now()}`;
      const expiresAt = new Date(Date.now() + EXECUTE_EVENT_TTL_MS);
      await deps.runtimeMutator.bump(agentId, [
        {
          id: eventId,
          kind: "experiment-execute",
          payload: { experimentId, task },
          expiresAt,
        },
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
      await deps.wakeAgent(agentId);
    },
  };
}
