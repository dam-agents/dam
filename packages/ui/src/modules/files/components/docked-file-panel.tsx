import { ArrowLeft } from "@carbon/icons-react";
import { TRPCClientError } from "@trpc/client";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { LoadFailed, PanelMessage } from "@/components/ui/empty-state";

import { TruncateStart } from "../../../components/truncate-start.js";
import { getErrorMessage } from "../../../lib/errors.js";
import { useStore } from "../../../store.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { SidePanelCloseButton } from "../../sessions/components/side-panel-close-button.js";
import { useFileContentQuery } from "../api/queries.js";
import { FileViewer } from "./file-viewer.js";

interface Props {
  onOpenFile: (path: string) => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the panel holds the file whose row is open, not the last file that finished reading: a big file takes a while, and the previous file's content must never sit under another file's name while it does.
export function DockedFilePanel({ onOpenFile }: Props) {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const openFilePath = useStore((s) =>
    s.dock?.kind === "file" ? s.dock.path : null,
  );
  const openFileDirty = useStore((s) => s.openFileDirty);
  const setDock = useStore((s) => s.setDock);
  const showConfirm = useStore((s) => s.showConfirm);

  const operable = useIsAgentOperable(selectedAgent);
  const {
    data: stale,
    error,
    refetch,
  } = useFileContentQuery(selectedAgent, openFilePath);

  const gone =
    error instanceof TRPCClientError && error.data?.code === "NOT_FOUND";
  const openFile = gone && !openFileDirty ? undefined : stale;

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

  if (openFile)
    return (
      <FileViewer
        key={openFile.path}
        file={openFile}
        onClose={close}
        onOpenFile={onOpenFile}
      />
    );
  if (!openFilePath) return null;
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 pl-2 pr-4 border-b border-border">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => void close()}
          aria-label="Back to files"
          tooltip="Back to files"
        >
          <ArrowLeft size={16} />
        </Button>
        <TruncateStart
          className="text-sm font-medium text-foreground flex-1 min-w-0"
          title={openFilePath}
        >
          {openFilePath}
        </TruncateStart>
        <SidePanelCloseButton />
      </div>
      <div className="flex-1 overflow-auto p-4">
        {gone ? (
          <PanelMessage tone="danger">
            {openFilePath} is not there any more.
          </PanelMessage>
        ) : !operable ? (
          <PanelMessage>
            This file shows once the agent is running.
          </PanelMessage>
        ) : error ? (
          <LoadFailed
            what={`Couldn't open ${openFilePath} — ${getErrorMessage(error)}`}
            onRetry={() => void refetch()}
          />
        ) : (
          <PanelMessage>Loading…</PanelMessage>
        )}
      </div>
    </div>
  );
}
