import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

const DEFAULT_SESSION_LIMIT = 3;
const SESSION_LIMIT_INCREMENT = 5;

export interface SidebarAgentsSlice {
  expandedSidebarAgents: Set<string>;
  sidebarSessionLimits: Map<string, number>;
  toggleSidebarAgent: (id: string) => void;
  showMoreSidebarSessions: (id: string) => void;
}

export const createSidebarAgentsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidebarAgentsSlice
> = (set) => ({
  expandedSidebarAgents: new Set(),
  sidebarSessionLimits: new Map(),
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
  showMoreSidebarSessions: (id) =>
    set((s) => {
      const limits = new Map(s.sidebarSessionLimits);
      const current = limits.get(id) ?? DEFAULT_SESSION_LIMIT;
      limits.set(id, current + SESSION_LIMIT_INCREMENT);
      return { sidebarSessionLimits: limits };
    }),
});
