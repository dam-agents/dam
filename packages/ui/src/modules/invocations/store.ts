import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface OwnerQuestionsSlice {
  postponedQuestions: ReadonlySet<string>;
  postponeQuestion: (key: string) => void;
  resumeQuestions: (keys: readonly string[]) => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the questions the user put off with Later, by sub-agent and time asked, so a chat they leave and come back to still shows the small waiting line instead of taking the input over again.
export const createOwnerQuestionsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  OwnerQuestionsSlice
> = (set) => ({
  postponedQuestions: new Set(),
  postponeQuestion: (key) =>
    set((s) => ({
      postponedQuestions: new Set([...s.postponedQuestions, key]),
    })),
  resumeQuestions: (keys) =>
    set((s) => {
      const next = new Set(s.postponedQuestions);
      for (const key of keys) next.delete(key);
      return { postponedQuestions: next };
    }),
});
