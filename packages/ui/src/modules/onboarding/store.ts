import type { StateCreator } from "zustand";

export interface OnboardingSlice {
  /** Bumped every time the user explicitly requests to reopen the welcome
   *  wizard (via Settings → Getting started). The wizard reads this as a
   *  signal to override its dismissal state. */
  welcomeWizardOpenRequest: number;
  openWelcomeWizard: () => void;
}

export const createOnboardingSlice: StateCreator<OnboardingSlice> = (set) => ({
  welcomeWizardOpenRequest: 0,
  openWelcomeWizard: () => set((s) => ({ welcomeWizardOpenRequest: s.welcomeWizardOpenRequest + 1 })),
});
