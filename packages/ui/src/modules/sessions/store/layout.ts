import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export type SessionNavVariant = "tabs" | "sidebar" | "header-dropdown";
export type ConfigPanelVariant =
  | "grouped"
  | "tabbed"
  | "context-bar"
  | "accordion"
  | "priority"
  | "sidebar-tabs"
  | "header-strip"
  | "drawer"
  | "detached"
  | "nested";

export type PanelSide = "left" | "right";

export interface LayoutSlice {
  sessionNavVariant: SessionNavVariant;
  setSessionNavVariant: (v: SessionNavVariant) => void;
  configPanelVariant: ConfigPanelVariant;
  setConfigPanelVariant: (v: ConfigPanelVariant) => void;
  panelSide: PanelSide;
  setPanelSide: (side: PanelSide) => void;
  setupPanelOpen: boolean;
  setupPanelSection: string | null;
  toggleSetupPanel: () => void;
  openSetupSection: (section: string) => void;
  artifactPanelOpen: boolean;
  artifactContent: { kind: "file"; path: string } | { kind: "log" } | null;
  openArtifact: (
    content: { kind: "file"; path: string } | { kind: "log" },
  ) => void;
  closeArtifact: () => void;
}

const VARIANT_KEY = "platform-session-nav-variant";
const CONFIG_VARIANT_KEY = "platform-config-panel-variant";

function loadVariant(): SessionNavVariant {
  const stored = localStorage.getItem(VARIANT_KEY);
  if (stored === "tabs" || stored === "sidebar" || stored === "header-dropdown")
    return stored;
  return "tabs";
}

const CONFIG_VARIANTS: ConfigPanelVariant[] = [
  "grouped",
  "tabbed",
  "context-bar",
  "accordion",
  "priority",
  "sidebar-tabs",
  "header-strip",
  "drawer",
  "detached",
  "nested",
];

function loadConfigVariant(): ConfigPanelVariant {
  const stored = localStorage.getItem(CONFIG_VARIANT_KEY);
  if (CONFIG_VARIANTS.includes(stored as ConfigPanelVariant))
    return stored as ConfigPanelVariant;
  return "grouped";
}

const PANEL_SIDE_KEY = "platform-panel-side";

function loadPanelSide(): PanelSide {
  const stored = localStorage.getItem(PANEL_SIDE_KEY);
  if (stored === "left" || stored === "right") return stored;
  return "left";
}

export const createLayoutSlice: StateCreator<
  PlatformStore,
  [],
  [],
  LayoutSlice
> = (set) => ({
  sessionNavVariant: loadVariant(),
  setSessionNavVariant: (v) => {
    localStorage.setItem(VARIANT_KEY, v);
    set({ sessionNavVariant: v });
  },
  configPanelVariant: loadConfigVariant(),
  setConfigPanelVariant: (v) => {
    localStorage.setItem(CONFIG_VARIANT_KEY, v);
    set({ configPanelVariant: v });
  },
  panelSide: loadPanelSide(),
  setPanelSide: (side) => {
    localStorage.setItem(PANEL_SIDE_KEY, side);
    set({ panelSide: side });
  },
  setupPanelOpen: false,
  setupPanelSection: null,
  toggleSetupPanel: () =>
    set((s) => ({
      setupPanelOpen: !s.setupPanelOpen,
      setupPanelSection: null,
    })),
  openSetupSection: (section) =>
    set({ setupPanelOpen: true, setupPanelSection: section }),
  artifactPanelOpen: false,
  artifactContent: null,
  openArtifact: (content) =>
    set({ artifactPanelOpen: true, artifactContent: content }),
  closeArtifact: () => set({ artifactPanelOpen: false, artifactContent: null }),
});
