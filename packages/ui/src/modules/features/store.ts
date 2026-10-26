import type { StateCreator } from "zustand";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../lib/persisted-prefs.js";

const FEATURES_MENU_KEY = "platform-debug:features-menu";

export interface FeaturesSlice {
  featuresMenuRevealed: boolean;
  setFeaturesMenuRevealed: (revealed: boolean) => void;
}

export const createFeaturesSlice: StateCreator<FeaturesSlice> = (set) => ({
  featuresMenuRevealed: readPersistedFlag(FEATURES_MENU_KEY, false),
  setFeaturesMenuRevealed: (revealed) => {
    writePersistedFlag(FEATURES_MENU_KEY, revealed);
    set({ featuresMenuRevealed: revealed });
  },
});
