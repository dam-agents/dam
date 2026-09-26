import { z } from "zod";
import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

const THEME_STORAGE_KEY = "platform-theme";

const themeSchema = z.enum(["light", "dark", "system"]);
export type Theme = z.infer<typeof themeSchema>;

export interface ThemeSlice {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export function isDarkTheme(theme: Theme): boolean {
  return (
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", isDarkTheme(theme));
}

export function readStoredTheme(): Theme {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {}
  if (raw === null) return "system";
  const parsed = themeSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      "[theme] schema mismatch on platform-theme, defaulting to 'system':",
      parsed.error.issues,
    );
    return "system";
  }
  return parsed.data;
}

export const createThemeSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ThemeSlice
> = (set) => ({
  theme: readStoredTheme(),
  setTheme: (t) => {
    localStorage.setItem(THEME_STORAGE_KEY, t);
    applyTheme(t);
    set({ theme: t });
  },
});
