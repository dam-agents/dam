import { useCallback } from "react";

import { getErrorMessage } from "@/lib/errors";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { fetchFileContent } from "../api/queries.js";

export function useFileTree(selectedAgent: string | null) {
  const openFilePath = useStore((s) =>
    s.dock?.kind === "file" ? s.dock.path : null,
  );
  const setDock = useStore((s) => s.setDock);
  const setOpenFileEdit = useStore((s) => s.setOpenFileEdit);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);
  const setFilesSectionOpen = useStore((s) => s.setFilesSectionOpen);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const confirmDiscard = useDockDraftGuard();

  const revealFiles = useCallback(() => {
    setSidePanelTab("files");
    setFilesSectionOpen(true);
    setMobileScreen("files");
  }, [setSidePanelTab, setFilesSectionOpen, setMobileScreen]);

  const openFileHandler = useCallback(
    async (path: string, opts?: { edit?: boolean }) => {
      if (!selectedAgent) return;
      if (openFilePath === path) {
        if (opts?.edit) setOpenFileEdit(true);
        revealFiles();
        return;
      }
      if (!(await confirmDiscard())) return;
      try {
        await fetchFileContent(selectedAgent, path);
        setDock({ kind: "file", path }, opts);
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
      confirmDiscard,
      setDock,
      setOpenFileEdit,
      revealFiles,
    ],
  );

  return { openFileHandler };
}
