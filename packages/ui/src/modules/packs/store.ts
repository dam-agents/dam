import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import type { Pack } from "./data/packs.js";
import {
  buildOnboardingSteps,
  isOnboardingComplete,
  type OnboardingState,
} from "./lib/onboarding.js";

export interface PacksSlice {
  pendingPack: Pack | null;
  setPendingPack: (pack: Pack | null) => void;
  demoAgents: Map<string, string>;
  setDemoAgent: (packId: string, agentId: string) => void;
  clearDemoAgent: (packId: string) => void;
  createdFromPack: Map<string, string>;
  setCreatedFromPack: (agentId: string, packId: string) => void;
  onboardingByAgent: Map<string, OnboardingState>;
  initOnboarding: (agentId: string, pack: Pack) => void;
  completeOnboardingStep: (agentId: string, stepId: string) => void;
  dismissOnboarding: (agentId: string) => void;
  realPacks: boolean;
  setRealPacks: (on: boolean) => void;
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
  createdFromPack: new Map(),
  setCreatedFromPack: (agentId, packId) =>
    set((s) => {
      const next = new Map(s.createdFromPack);
      next.set(agentId, packId);
      return { createdFromPack: next };
    }),
  onboardingByAgent: new Map(),
  initOnboarding: (agentId, pack) =>
    set((s) => {
      const next = new Map(s.onboardingByAgent);
      next.set(agentId, {
        packId: pack.id,
        packName: pack.name,
        steps: buildOnboardingSteps(pack),
        completed: false,
      });
      return { onboardingByAgent: next };
    }),
  completeOnboardingStep: (agentId, stepId) =>
    set((s) => {
      const current = s.onboardingByAgent.get(agentId);
      if (!current) return s;
      const steps = current.steps.map((step) =>
        step.id === stepId ? { ...step, done: true } : step,
      );
      const next = new Map(s.onboardingByAgent);
      next.set(agentId, {
        ...current,
        steps,
        completed: isOnboardingComplete(steps),
      });
      return { onboardingByAgent: next };
    }),
  dismissOnboarding: (agentId) =>
    set((s) => {
      const next = new Map(s.onboardingByAgent);
      next.delete(agentId);
      return { onboardingByAgent: next };
    }),
  realPacks: true,
  setRealPacks: (on) => set({ realPacks: on }),
});
