import type { SidebarOrderService } from "api-server-api";

import type { SidebarOrderRepository } from "../infrastructure/sidebar-order-repository.js";

export function createSidebarOrderService(deps: {
  repo: SidebarOrderRepository;
  owner: string;
}): SidebarOrderService {
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
