import { useCallback } from "react";

import { emitToast } from "../../../lib/toast.js";
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
  const setOpenFileEdit = useStore((s) => s.setOpenFileEdit);
  const setFilesSectionOpen = useStore((s) => s.setFilesSectionOpen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const showConfirm = useStore((s) => s.showConfirm);

  // Files live in the chat's left panel — reveal that section (and, on mobile,
  // the sessions screen it sits on) when opening a file from anywhere.
  const revealFiles = useCallback(() => {
    setFilesSectionOpen(true);
    setMobileScreen("sessions");
  }, [setFilesSectionOpen, setMobileScreen]);

  const openFileHandler = useCallback(
    async (path: string, opts?: { edit?: boolean }) => {
      if (!selectedAgent) return;
      if (openFilePath === path) {
        // Re-selecting the open file resurfaces it; the viewer owns closing.
        if (opts?.edit) setOpenFileEdit(true);
        revealFiles();
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
        setOpenFilePath(path, opts);
        revealFiles();
      } catch (err) {
        emitToast({
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
      setOpenFileEdit,
      revealFiles,
      showConfirm,
    ],
  );

  return { openFileHandler };
}
