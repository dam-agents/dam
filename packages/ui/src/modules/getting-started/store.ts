import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-prefs.js";

const CHECKLIST_EXPANDED_STORAGE_KEY = "platform-getting-started-expanded";

export interface GettingStartedSlice {
  checklistExpanded: boolean;
  setChecklistExpanded: (expanded: boolean) => void;
}

export const createGettingStartedSlice: StateCreator<GettingStartedSlice> = (
  set,
) => ({
  checklistExpanded: readPersistedFlag(CHECKLIST_EXPANDED_STORAGE_KEY, false),
  setChecklistExpanded: (expanded) => {
    writePersistedFlag(CHECKLIST_EXPANDED_STORAGE_KEY, expanded);
    set({ checklistExpanded: expanded });
  },
});
