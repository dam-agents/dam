import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect } from "react";

import { useStore } from "../../../store.js";
import { useFileContentQuery } from "../api/queries.js";
import { FileViewer } from "./file-viewer.js";

interface Props {
  onOpenFile: (path: string) => void;
}

export function DockedFilePanel({ onOpenFile }: Props) {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const openFilePath = useStore((s) =>
    s.dock?.kind === "file" ? s.dock.path : null,
  );
  const openFileDirty = useStore((s) => s.openFileDirty);
  const setDock = useStore((s) => s.setDock);
  const showConfirm = useStore((s) => s.showConfirm);

  const { data: openFile, error } = useFileContentQuery(
    selectedAgent,
    openFilePath,
  );

  useEffect(() => {
    const gone =
      error instanceof TRPCClientError && error.data?.code === "NOT_FOUND";
    if (gone && !openFileDirty) setDock(null);
  }, [error, openFileDirty, setDock]);

  const close = useCallback(async () => {
    if (
      openFileDirty &&
      !(await showConfirm("Your edits are lost.", "Discard unsaved changes?", {
        kind: "destructive",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      }))
    )
      return;
    setDock(null);
  }, [openFileDirty, showConfirm, setDock]);

  if (!openFile) return null;
  return (
    <FileViewer
      key={openFile.path}
      file={openFile}
      onClose={close}
      onOpenFile={onOpenFile}
    />
  );
}
