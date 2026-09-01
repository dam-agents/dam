import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import type { Pack } from "./data/packs.js";

export interface PacksSlice {
  pendingPack: Pack | null;
  setPendingPack: (pack: Pack | null) => void;
  demoAgents: Map<string, string>;
  setDemoAgent: (packId: string, agentId: string) => void;
  clearDemoAgent: (packId: string) => void;
}

export const createPacksSlice: StateCreator<
  PlatformStore,
  [],
  [],
  PacksSlice
> = (set) => ({
  pendingPack: null,
  setPendingPack: (pack) => set({ pendingPack: pack }),
  demoAgents: new Map(),
  setDemoAgent: (packId, agentId) =>
    set((s) => {
      const next = new Map(s.demoAgents);
      next.set(packId, agentId);
      return { demoAgents: next };
    }),
  clearDemoAgent: (packId) =>
    set((s) => {
      const next = new Map(s.demoAgents);
      next.delete(packId);
      return { demoAgents: next };
    }),
});
