import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import type { KbIntent } from "./lib/kb-intents.js";

export interface KnowledgeBasesSlice {
  pendingKbIntent: KbIntent | null;
  setPendingKbIntent: (intent: KbIntent | null) => void;
  demoKbs: Map<string, string>;
  setDemoKb: (intentId: string, agentId: string) => void;
}

export const createKnowledgeBasesSlice: StateCreator<
  PlatformStore,
  [],
  [],
  KnowledgeBasesSlice
> = (set) => ({
  pendingKbIntent: null,
  setPendingKbIntent: (intent) => set({ pendingKbIntent: intent }),
  demoKbs: new Map(),
  setDemoKb: (intentId, agentId) =>
    set((s) => {
      const next = new Map(s.demoKbs);
      next.set(intentId, agentId);
      return { demoKbs: next };
    }),
});
