import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

/** A run whose launch session hasn't appeared yet. Between "Start a new run"
 *  and the pod waking + the runtime opening the launch session, nothing else
 *  in the UI moves — this bridges the gap: it disables the agent's Start
 *  buttons (no accidental second run), renders a skeleton row in the
 *  sidebar's Experiment runs group, and — while `focused` — takes over the
 *  chat pane with a loader that the real session replaces. Focus starts
 *  true (the click wants to follow the launch) and drops when the user
 *  deliberately navigates elsewhere. */
export interface ExperimentsSlice {
  pendingLaunch: { agentId: string; runId: string; focused: boolean } | null;
  setPendingLaunch: (pending: { agentId: string; runId: string }) => void;
  focusPendingLaunch: () => void;
  unfocusPendingLaunch: () => void;
  /** Scoped by runId so a stale clear never wipes a newer launch. */
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
