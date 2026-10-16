import type { z } from "zod";

import type { sidebarPinsSchema } from "./schemas.js";

export type SidebarPins = z.infer<typeof sidebarPinsSchema>;

export interface SidebarPinsService {
  get(): Promise<SidebarPins>;
  setAgents(agentIds: readonly string[]): Promise<SidebarPins>;
  setSessions(
    agentId: string,
    sessionIds: readonly string[],
  ): Promise<SidebarPins>;
}
