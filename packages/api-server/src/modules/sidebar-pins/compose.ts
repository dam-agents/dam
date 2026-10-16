import type { Db } from "db";
import type { SidebarPinsService } from "api-server-api";

import { createSidebarPinsRepository } from "./infrastructure/sidebar-pins-repository.js";
import { createSidebarPinsService } from "./services/sidebar-pins-service.js";

export interface SidebarPinsModule {
  forOwner(owner: string): SidebarPinsService;
  listAgentIds(): Promise<string[]>;
  deleteForAgent(agentId: string): Promise<void>;
}

export function composeSidebarPinsModule(deps: { db: Db }): SidebarPinsModule {
  const repo = createSidebarPinsRepository(deps.db);
  return {
    forOwner: (owner) => createSidebarPinsService({ repo, owner }),
    listAgentIds: () => repo.listAgentIds(),
    deleteForAgent: (agentId) => repo.deleteForAgent(agentId),
  };
}
