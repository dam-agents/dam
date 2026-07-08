import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export type RightTab = "files" | "configuration" | "metrics";

export interface FilesSlice {
  /** Path of the file currently open in the viewer. The content itself lives
   *  in the TanStack Query cache (see modules/files/api/queries.ts); this
   *  field is the UI-state side of the pair. */
  openFilePath: string | null;
  rightTab: RightTab;
  /** Whether the file-viewer has an unsaved in-memory edit. Surfaced here so
   *  the tree-click handler can prompt before discarding. */
  openFileDirty: boolean;
  openFileEdit: boolean;
  expandedDirs: Record<string, Set<string>>;
  /** In-flight import count per agent; count not bool so overlapping uploads compose. */
  importingAgents: Record<string, number>;
  setOpenFilePath: (path: string | null, opts?: { edit?: boolean }) => void;
  setOpenFileEdit: (edit: boolean) => void;
  setRightTab: (tab: RightTab) => void;
  setOpenFileDirty: (dirty: boolean) => void;
  toggleExpandedDir: (agentId: string, path: string) => void;
  pruneExpandedDir: (agentId: string, path: string) => void;
  renameExpandedDir: (agentId: string, from: string, to: string) => void;
  beginImport: (agentId: string) => void;
  endImport: (agentId: string) => void;
}

/** Drop `prefix` and every path nested under it. Collapsing a parent must
 *  also forget its expanded children, otherwise they keep shipping in the
 *  batched poll even though no DirContents is mounted to render them. */
function withoutPath(set: Set<string>, prefix: string): Set<string> {
  const next = new Set<string>();
  for (const p of set) {
    if (p !== prefix && !p.startsWith(prefix + "/")) next.add(p);
  }
  return next;
}

/** Rewrite `from` and every path nested under it to live under `to`. Used
 *  after a rename so an expanded subtree follows its new parent path
 *  instead of evaporating. */
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
  rightTab: "files",
  openFileDirty: false,
  openFileEdit: false,
  expandedDirs: {},
  importingAgents: {},
  setOpenFilePath: (path, opts) =>
    set({
      openFilePath: path,
      openFileDirty: false,
      openFileEdit: opts?.edit ?? false,
    }),
  setOpenFileEdit: (edit) => set({ openFileEdit: edit }),
  setRightTab: (tab) => set({ rightTab: tab }),
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
