import { useCallback, useEffect } from "react";

import { useStore } from "../../../store.js";
import { useFileContentQuery } from "../api/queries.js";
import { FileViewer } from "./file-viewer.js";

/** Body of the on-demand right file panel: resolves `openFilePath` to content
 *  and hosts the viewer. Closes silently when the file disappears
 *  (rename/delete/git switch); guards a dirty draft on explicit close. */
export function DockedFilePanel({
  onOpenFile,
}: {
  onOpenFile: (path: string) => void;
}) {
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
    if (error) setOpenFilePath(null);
  }, [error, setOpenFilePath]);

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
