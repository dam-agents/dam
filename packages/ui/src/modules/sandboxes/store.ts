import type { StateCreator } from "zustand";

import type { SandboxSection } from "../platform/lib/routes.js";

export interface AgentSettingsTarget {
  agentId: string;
  section: SandboxSection;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: which Agent's settings modal is open, and at
 * which section. It lives above every view, so a wrench opens the same modal
 * from the chat, the sidebar or Home, over whatever the person is looking at.
 */
export interface AgentSettingsSlice {
  agentSettings: AgentSettingsTarget | null;
  openAgentSettings: (agentId: string, section?: SandboxSection) => void;
  closeAgentSettings: () => void;
}

export const createAgentSettingsSlice: StateCreator<AgentSettingsSlice> = (
  set,
) => ({
  agentSettings: null,
  openAgentSettings: (agentId, section = "setup") =>
    set({ agentSettings: { agentId, section } }),
  closeAgentSettings: () => set({ agentSettings: null }),
});
