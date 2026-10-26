import type { StateCreator } from "zustand";

const FEATURES_MENU_STORAGE_KEY = "platform-debug:features-menu";

export interface FeaturesSlice {
  featuresMenuRevealed: boolean;
  setFeaturesMenuRevealed: (revealed: boolean) => void;
}

function readStoredFeaturesMenuRevealed(): boolean {
  try {
    return localStorage.getItem(FEATURES_MENU_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export const createFeaturesSlice: StateCreator<FeaturesSlice> = (set) => ({
  featuresMenuRevealed: readStoredFeaturesMenuRevealed(),
  setFeaturesMenuRevealed: (revealed) => {
    if (revealed) {
      localStorage.setItem(FEATURES_MENU_STORAGE_KEY, "true");
    } else {
      localStorage.removeItem(FEATURES_MENU_STORAGE_KEY);
    }
    set({ featuresMenuRevealed: revealed });
  },
});
