import type { StateCreator } from "zustand";

import type { SandboxSection } from "../platform/lib/routes.js";

export interface AgentSettingsTarget {
  agentId: string;
  section: SandboxSection;
  focus?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: which Agent's settings modal is open, and at
 * which section. It lives above every view, so a wrench opens the same modal
 * from the chat, the sidebar or Home, over whatever the person is looking at.
 */
export interface AgentSettingsSlice {
  agentSettings: AgentSettingsTarget | null;
  openAgentSettings: (
    agentId: string,
    section?: SandboxSection,
    focus?: string,
  ) => void;
  clearAgentSettingsFocus: () => void;
  closeAgentSettings: () => void;
}

export const createAgentSettingsSlice: StateCreator<AgentSettingsSlice> = (
  set,
) => ({
  agentSettings: null,
  openAgentSettings: (agentId, section = "setup", focus) =>
    set({ agentSettings: { agentId, section, ...(focus && { focus }) } }),
  clearAgentSettingsFocus: () =>
    set((s) =>
      s.agentSettings?.focus
        ? { agentSettings: { ...s.agentSettings, focus: undefined } }
        : s,
    ),
  closeAgentSettings: () => set({ agentSettings: null }),
});
