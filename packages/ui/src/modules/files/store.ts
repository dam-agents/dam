import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface FilesSlice {
  openFilePath: string | null;
  filesSectionOpen: boolean;
  openFileDirty: boolean;
  openFileEdit: boolean;
  expandedDirs: Record<string, Set<string>>;
  importingAgents: Record<string, number>;
  setOpenFilePath: (path: string | null, opts?: { edit?: boolean }) => void;
  setOpenFileEdit: (edit: boolean) => void;
  setFilesSectionOpen: (open: boolean) => void;
  setOpenFileDirty: (dirty: boolean) => void;
  toggleExpandedDir: (agentId: string, path: string) => void;
  pruneExpandedDir: (agentId: string, path: string) => void;
  renameExpandedDir: (agentId: string, from: string, to: string) => void;
  beginImport: (agentId: string) => void;
  endImport: (agentId: string) => void;
}

function withoutPath(set: Set<string>, prefix: string): Set<string> {
  const next = new Set<string>();
  for (const p of set) {
    if (p !== prefix && !p.startsWith(prefix + "/")) next.add(p);
  }
  return next;
}

function rewritePrefix(
  set: Set<string>,
  from: string,
  to: string,
): Set<string> {
  const next = new Set<string>();
  for (const p of set) {
    if (p === from) next.add(to);
    else if (p.startsWith(from + "/")) next.add(to + p.slice(from.length));
    else next.add(p);
  }
  return next;
}

export const createFilesSlice: StateCreator<
  PlatformStore,
  [],
  [],
  FilesSlice
> = (set) => ({
  openFilePath: null,
  filesSectionOpen: true,
  openFileDirty: false,
  openFileEdit: false,
  expandedDirs: {},
  importingAgents: {},
  setOpenFilePath: (path, opts) =>
    set({
      openFilePath: path,
      openFileDirty: false,
      openFileEdit: opts?.edit ?? false,
      ...(path !== null ? { openArtifactId: null } : {}),
    }),
  setOpenFileEdit: (edit) => set({ openFileEdit: edit }),
  setFilesSectionOpen: (open) => set({ filesSectionOpen: open }),
  setOpenFileDirty: (dirty) => set({ openFileDirty: dirty }),
  toggleExpandedDir: (agentId, path) => {
    set((state) => {
      const current = state.expandedDirs[agentId] ?? new Set<string>();
      const next = current.has(path)
        ? withoutPath(current, path)
        : new Set(current).add(path);
      return { expandedDirs: { ...state.expandedDirs, [agentId]: next } };
    });
  },
  pruneExpandedDir: (agentId, path) => {
    set((state) => {
      const current = state.expandedDirs[agentId];
      if (!current || !current.has(path)) return state;
      return {
        expandedDirs: {
          ...state.expandedDirs,
          [agentId]: withoutPath(current, path),
        },
      };
    });
  },
  renameExpandedDir: (agentId, from, to) => {
    set((state) => {
      const current = state.expandedDirs[agentId];
      if (!current) return state;
      return {
        expandedDirs: {
          ...state.expandedDirs,
          [agentId]: rewritePrefix(current, from, to),
        },
      };
    });
  },
  beginImport: (agentId) => {
    set((state) => ({
      importingAgents: {
        ...state.importingAgents,
        [agentId]: (state.importingAgents[agentId] ?? 0) + 1,
      },
    }));
  },
  endImport: (agentId) => {
    set((state) => {
      const next = (state.importingAgents[agentId] ?? 0) - 1;
      const importingAgents = { ...state.importingAgents };
      if (next > 0) importingAgents[agentId] = next;
      else delete importingAgents[agentId];
      return { importingAgents };
    });
  },
});
