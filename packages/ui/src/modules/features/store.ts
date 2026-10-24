import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-prefs.js";

const FEATURES_MENU_KEY = "platform-debug:features-menu";

export interface FeaturesSlice {
  featuresMenuRevealed: boolean;
  setFeaturesMenuRevealed: (revealed: boolean) => void;
  unifiedToolbar: boolean;
  setUnifiedToolbar: (on: boolean) => void;
}

export const createFeaturesSlice: StateCreator<FeaturesSlice> = (set) => ({
  featuresMenuRevealed: readPersistedFlag(FEATURES_MENU_KEY, false),
  setFeaturesMenuRevealed: (revealed) => {
    writePersistedFlag(FEATURES_MENU_KEY, revealed);
    set({ featuresMenuRevealed: revealed });
  },
  // UNIT_BOUNDARY_DESCRIPTION: the experiment's value, kept where code that is not a component can read it: a click on any link to the Agent's configuration page becomes an open panel, without every caller passing the flag.
  unifiedToolbar: false,
  setUnifiedToolbar: (on) => set({ unifiedToolbar: on }),
});
