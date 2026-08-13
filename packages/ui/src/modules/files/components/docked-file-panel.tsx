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
  const openFilePath = useStore((s) => s.openFilePath);
  const openFileDirty = useStore((s) => s.openFileDirty);
  const setOpenFilePath = useStore((s) => s.setOpenFilePath);
  const showConfirm = useStore((s) => s.showConfirm);

  const { data: openFile, error } = useFileContentQuery(
    selectedAgent,
    openFilePath,
  );

  useEffect(() => {
    const gone =
      error instanceof TRPCClientError && error.data?.code === "NOT_FOUND";
    if (gone && !openFileDirty) setOpenFilePath(null);
  }, [error, openFileDirty, setOpenFilePath]);

  const close = useCallback(async () => {
    if (
      openFileDirty &&
      !(await showConfirm("Discard unsaved changes?", "Unsaved changes"))
    )
      return;
    setOpenFilePath(null);
  }, [openFileDirty, showConfirm, setOpenFilePath]);

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
