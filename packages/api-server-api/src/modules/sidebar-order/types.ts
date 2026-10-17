import type { z } from "zod";

import type { sidebarOrderSchema } from "./schemas.js";

export type SidebarOrder = z.infer<typeof sidebarOrderSchema>;

export interface SidebarOrderService {
  get(): Promise<SidebarOrder>;
  setAgents(agentIds: readonly string[]): Promise<SidebarOrder>;
  setSessions(
    agentId: string,
    sessionIds: readonly string[],
  ): Promise<SidebarOrder>;
}
