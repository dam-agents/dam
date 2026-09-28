import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

const DEFAULT_SESSION_LIMIT = 3;
const SESSION_LIMIT_INCREMENT = 5;
export const SIDEBAR_DESIGN_VARIANT_COUNT = 10;

export interface SidebarAgentsSlice {
  expandedSidebarAgents: Set<string>;
  sidebarSessionLimits: Map<string, number>;
  sidebarDesignVariant: number;
  toggleSidebarAgent: (id: string) => void;
  showMoreSidebarSessions: (id: string) => void;
  cycleSidebarDesign: (direction: 1 | -1) => void;
}

export const createSidebarAgentsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SidebarAgentsSlice
> = (set) => ({
  expandedSidebarAgents: new Set(),
  sidebarSessionLimits: new Map(),
  sidebarDesignVariant: 1,
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
  cycleSidebarDesign: (direction) =>
    set((s) => {
      let next = s.sidebarDesignVariant + direction;
      if (next < 1) next = SIDEBAR_DESIGN_VARIANT_COUNT;
      if (next > SIDEBAR_DESIGN_VARIANT_COUNT) next = 1;
      return { sidebarDesignVariant: next };
    }),
});
