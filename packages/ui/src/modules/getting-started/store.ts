import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface GettingStartedSlice {
  checklistExpanded: boolean;
  setChecklistExpanded: (expanded: boolean) => void;
}

export const createGettingStartedSlice: StateCreator<
  PlatformStore,
  [],
  [],
  GettingStartedSlice
> = (set) => ({
  checklistExpanded: false,
  setChecklistExpanded: (expanded) => set({ checklistExpanded: expanded }),
});
