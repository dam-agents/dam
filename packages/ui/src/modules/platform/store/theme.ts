import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export type Theme = "light" | "dark" | "system";

export interface ThemeSlice {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

function applyTheme(theme: Theme) {
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

export const createThemeSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ThemeSlice
> = (set) => ({
  theme: (localStorage.getItem("platform-theme") as Theme) || "system",
  setTheme: (t) => {
    localStorage.setItem("platform-theme", t);
    applyTheme(t);
    set({ theme: t });
  },
});
