import type { AgentRegistryRow } from "../domain/types.js";

export type BootstrapAgentsDeps = {
  listIdentities: () => Promise<{ id: string; owner: string }[]>;
  upsertAgent: (row: AgentRegistryRow) => Promise<void>;
};

export async function bootstrapAgents(
  deps: BootstrapAgentsDeps,
): Promise<void> {
  const k8sAgents = await deps.listIdentities();
  for (const a of k8sAgents) {
    await deps.upsertAgent({ id: a.id, ownerSub: a.owner });
  }
}
