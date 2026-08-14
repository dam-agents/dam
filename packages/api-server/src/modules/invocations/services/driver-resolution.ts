import type { InvocationsRepository } from "../infrastructure/invocations-repository.js";

const MAX_CHAIN_DEPTH = 16;

export interface DriverResolution {
  resolveRoot(agentId: string): Promise<string | null>;
}

export function createDriverResolution(deps: {
  repo: InvocationsRepository;
}): DriverResolution {
  return {
    async resolveRoot(agentId) {
      let current = agentId;
      for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
        const row = await deps.repo.get(current);
        if (!row) return current;
        current = row.driverAgentId;
      }
      return null;
    },
  };
}
