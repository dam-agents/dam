import type {
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from "@agentclientprotocol/sdk/dist/acp.js";
import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export interface SessionConfigSlice {
  sessionModes: SessionModeState | null;
  sessionModels: SessionModelState | null;
  sessionConfigOptions: SessionConfigOption[];
  setSessionModes: (modes: SessionModeState | null) => void;
  setSessionModels: (models: SessionModelState | null) => void;
  setSessionConfigOptions: (options: SessionConfigOption[]) => void;
}

export const createSessionConfigSlice: StateCreator<
  PlatformStore,
  [],
  [],
  SessionConfigSlice
> = (set) => ({
  sessionModes: null,
  sessionModels: null,
  sessionConfigOptions: [],
  setSessionModes: (modes) => set({ sessionModes: modes }),
  setSessionModels: (models) => set({ sessionModels: models }),
  setSessionConfigOptions: (options) => set({ sessionConfigOptions: options }),
});
