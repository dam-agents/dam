import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

const DEFAULT_SESSION_LIMIT = 50;
const SESSION_LIMIT_INCREMENT = 50;

export interface SidebarAgentsSlice {
  expandedSidebarAgents: Set<string>;
  sidebarSessionLimits: Map<string, number>;
  sidebarActiveSessionId: string | null;
  toggleSidebarAgent: (id: string) => void;
  expandSidebarAgent: (id: string) => void;
  showMoreSidebarSessions: (id: string) => void;
  setSidebarActiveSession: (sessionId: string | null) => void;
}

export const createSidebarAgentsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidebarAgentsSlice
> = (set) => ({
  expandedSidebarAgents: new Set(),
  sidebarSessionLimits: new Map(),
  sidebarActiveSessionId: null,
  toggleSidebarAgent: (id) =>
    set((s) => {
      const next = new Set(s.expandedSidebarAgents);
      const limits = new Map(s.sidebarSessionLimits);
      if (next.has(id)) {
        next.delete(id);
        limits.delete(id);
      } else {
        next.add(id);
        limits.set(id, DEFAULT_SESSION_LIMIT);
      }
      return { expandedSidebarAgents: next, sidebarSessionLimits: limits };
    }),
  expandSidebarAgent: (id) =>
    set((s) => {
      if (s.expandedSidebarAgents.has(id)) return s;
      const next = new Set(s.expandedSidebarAgents);
      next.add(id);
      return { expandedSidebarAgents: next };
    }),
  showMoreSidebarSessions: (id) =>
    set((s) => {
      const limits = new Map(s.sidebarSessionLimits);
      const current = limits.get(id) ?? DEFAULT_SESSION_LIMIT;
      limits.set(id, current + SESSION_LIMIT_INCREMENT);
      return { sidebarSessionLimits: limits };
    }),
  setSidebarActiveSession: (sessionId) =>
    set({ sidebarActiveSessionId: sessionId }),
});
