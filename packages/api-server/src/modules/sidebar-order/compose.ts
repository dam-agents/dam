import type { Db } from "db";
import type { SidebarOrderService } from "api-server-api";

import { createSidebarOrderRepository } from "./infrastructure/sidebar-order-repository.js";
import { createSidebarOrderService } from "./services/sidebar-order-service.js";

export interface SidebarOrderModule {
  forOwner(owner: string): SidebarOrderService;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

export function composeSidebarOrderModule(deps: {
  db: Db;
}): SidebarOrderModule {
  const repo = createSidebarOrderRepository(deps.db);
  return {
    forOwner: (owner) => createSidebarOrderService({ repo, owner }),
    listAgentIds: () => repo.listAgentIds(),
    deleteForAgent: (agentId) => repo.deleteForAgent(agentId),
  };
}
