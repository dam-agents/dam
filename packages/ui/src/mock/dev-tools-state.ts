import { create } from "zustand";

import type { EnvironmentStatus } from "../types.js";

type ChangesStatus = "loading" | "done" | "error" | "pr-open";
type ProcessStatus = "running" | "finished" | "failed" | "restart-waiting";
type BrowserStatus = "loading" | "ready" | "error" | "agent-asleep";

export interface DevToolsState {
  changesStatus: ChangesStatus | null;
  processStatus: ProcessStatus | null;
  browserStatus: BrowserStatus | null;
  environmentStatus: EnvironmentStatus | null;
  setChangesStatus: (v: ChangesStatus | null) => void;
  setProcessStatus: (v: ProcessStatus | null) => void;
  setBrowserStatus: (v: BrowserStatus | null) => void;
  setEnvironmentStatus: (v: EnvironmentStatus | null) => void;
}

export const useDevToolsState = create<DevToolsState>((set) => ({
  changesStatus: null,
  processStatus: null,
  browserStatus: null,
  environmentStatus: null,
  setChangesStatus: (v) => set({ changesStatus: v }),
  setProcessStatus: (v) => set({ processStatus: v }),
  setBrowserStatus: (v) => set({ browserStatus: v }),
  setEnvironmentStatus: (v) => set({ environmentStatus: v }),
}));
