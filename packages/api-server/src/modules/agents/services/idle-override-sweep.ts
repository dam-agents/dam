import type { InfraAgent } from "../infrastructure/agent-mappers.js";

// UNIT_BOUNDARY_DESCRIPTION: clears the idle override of every regular Agent, so each sleeps on the install's idle timeout. It reads and writes through the agents repository, so it serves both the custom resources and the control tables, and it runs on a schedule so an override restored by an older client, an absorb or a rollback is cleared again. An Environment and an Invocation target keep theirs: the api-server sets those itself. A target is told apart by its invocation row, which is written before its Agent.
export function createIdleOverrideSweep(deps: {
  listAgents: () => Promise<InfraAgent[]>;
  invocationIds: (agentIds: string[]) => Promise<Set<string>>;
  clear: (agentId: string) => Promise<unknown>;
}): () => Promise<number> {
  return async () => {
    const carrying = (await deps.listAgents()).filter(
      (agent) =>
        agent.spec.hibernationTimeout !== undefined &&
        agent.spec.hibernationTimeout !== null &&
        !agent.spec.environmentOf,
    );
    if (carrying.length === 0) return 0;
    const targets = await deps.invocationIds(carrying.map((a) => a.id));
    const regular = carrying.filter((agent) => !targets.has(agent.id));
    for (const agent of regular) await deps.clear(agent.id);
    return regular.length;
  };
}
