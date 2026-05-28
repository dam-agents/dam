import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { fetchFileContent } from "../api/queries.js";

/**
 * Exposes a single `openFileHandler` for opening a file from anywhere in the
 * chat surface (side panel click, Markdown link, etc.). The resulting content
 * lives in the TanStack Query cache; components render via useFileContentQuery.
 */
export function useFileTree(selectedAgent: string | null) {
  const openFilePath = useStore((s) => s.openFilePath);
  const openFileDirty = useStore((s) => s.openFileDirty);
  const setOpenFilePath = useStore((s) => s.setOpenFilePath);
  const setRightTab = useStore((s) => s.setRightTab);
  const showToast = useStore((s) => s.showToast);
  const showConfirm = useStore((s) => s.showConfirm);

  const openFileHandler = useCallback(
    async (path: string) => {
      if (!selectedAgent) return;
      if (openFilePath === path) {
        if (openFileDirty) {
          const ok = await showConfirm(
            "Discard unsaved changes?",
            "Unsaved changes",
          );
          if (!ok) return;
        }
        setOpenFilePath(null);
        return;
      }
      if (openFileDirty) {
        const ok = await showConfirm(
          "Discard unsaved changes?",
          "Unsaved changes",
        );
        if (!ok) return;
      }
      try {
        // Pre-warm the content cache before switching the viewer so the UI
        // doesn't flash empty while the poll-driven subscription catches up.
        await fetchFileContent(selectedAgent, path);
        setOpenFilePath(path);
        setRightTab("files");
      } catch (err) {
        showToast({
          kind: "error",
          message:
            err instanceof Error && err.message
              ? err.message
              : `Couldn't open ${path}`,
        });
      }
    },
    [
      selectedAgent,
      openFilePath,
      openFileDirty,
      setOpenFilePath,
      setRightTab,
      showToast,
      showConfirm,
    ],
  );

  return { openFileHandler };
}
