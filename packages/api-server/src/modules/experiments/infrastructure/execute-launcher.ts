import type { RuntimeMutator } from "../../runtime-delivery/index.js";

export interface ExecuteLauncher {
  launch(input: {
    agentId: string;
    experimentId: string;
    task: string;
  }): Promise<void>;
}

export function createExecuteLauncher(deps: {
  runtimeMutator: RuntimeMutator;
  wakeAgent: (agentId: string) => Promise<void>;
  now?: () => Date;
  ttlSeconds?: number;
}): ExecuteLauncher {
  const now = deps.now ?? (() => new Date());
  const ttlSec = deps.ttlSeconds ?? 3600;
  return {
    async launch({ agentId, experimentId, task }) {
      const eventId = `experiment:${experimentId}:${now().getTime()}`;
      const expiresAt = new Date(now().getTime() + ttlSec * 1000);
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
