import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface ExperimentsSlice {
  pendingLaunch: { agentId: string; runId: string; focused: boolean } | null;
  setPendingLaunch: (pending: { agentId: string; runId: string }) => void;
  focusPendingLaunch: () => void;
  unfocusPendingLaunch: () => void;
  clearPendingLaunch: (runId: string) => void;
}

export const createExperimentsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ExperimentsSlice
> = (set) => ({
  pendingLaunch: null,
  setPendingLaunch: (pending) =>
    set({ pendingLaunch: { ...pending, focused: true } }),
  focusPendingLaunch: () =>
    set((state) =>
      state.pendingLaunch
        ? { pendingLaunch: { ...state.pendingLaunch, focused: true } }
        : {},
    ),
  unfocusPendingLaunch: () =>
    set((state) =>
      state.pendingLaunch
        ? { pendingLaunch: { ...state.pendingLaunch, focused: false } }
        : {},
    ),
  clearPendingLaunch: (runId) =>
    set((state) =>
      state.pendingLaunch?.runId === runId ? { pendingLaunch: null } : {},
    ),
});
