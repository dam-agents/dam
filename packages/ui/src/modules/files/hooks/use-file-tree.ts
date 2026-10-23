import { useCallback } from "react";

import { getErrorMessage } from "@/lib/errors";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { fetchFileContent } from "../api/queries.js";

export function useFileTree(selectedAgent: string | null) {
  const openFilePath = useStore((s) => s.openFilePath);
  const openFileDirty = useStore((s) => s.openFileDirty);
  const setOpenFilePath = useStore((s) => s.setOpenFilePath);
  const setOpenFileEdit = useStore((s) => s.setOpenFileEdit);
  const setFilesSectionOpen = useStore((s) => s.setFilesSectionOpen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const showConfirm = useStore((s) => s.showConfirm);

  const revealFiles = useCallback(() => {
    setFilesSectionOpen(true);
    setMobileScreen("sessions");
  }, [setFilesSectionOpen, setMobileScreen]);

  const openFileHandler = useCallback(
    async (path: string, opts?: { edit?: boolean }) => {
      if (!selectedAgent) return;
      if (openFilePath === path) {
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
        await fetchFileContent(selectedAgent, path);
        setOpenFilePath(path, opts);
        revealFiles();
      } catch (err) {
        emitToast({
          kind: "error",
          message: getErrorMessage(err, `Couldn't open ${path}`),
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
