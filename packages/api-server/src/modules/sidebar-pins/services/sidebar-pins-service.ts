import type { SidebarPinsService } from "api-server-api";

import type { SidebarPinsRepository } from "../infrastructure/sidebar-pins-repository.js";

export function createSidebarPinsService(deps: {
  repo: SidebarPinsRepository;
  owner: string;
}): SidebarPinsService {
  const get = () => deps.repo.find(deps.owner);
  return {
    get,
    async setAgents(agentIds) {
      await deps.repo.replaceAgents(deps.owner, [...new Set(agentIds)]);
      return get();
    },
    async setSessions(agentId, sessionIds) {
      await deps.repo.replaceSessions(deps.owner, agentId, [
        ...new Set(sessionIds),
      ]);
      return get();
    },
  };
}
