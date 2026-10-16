import { Close, Maximize, Save } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useCallback, useId, useRef, useState } from "react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-size";

import { FullscreenPreviewDialog } from "../../files/components/fullscreen-preview-dialog.js";
import {
  useArtifact,
  useArtifactContent,
  useArtifactPreview,
  useArtifactVersions,
} from "../api/queries.js";
import { useArtifactEditor } from "../hooks/use-artifact-editor.js";
import { useStartArtifactSession } from "../hooks/use-start-artifact-session.js";
import { isEditableArtifact } from "../lib/editable.js";
import { isRenderedKind } from "../lib/kinds.js";
import { ArtifactVisibilityButton } from "./artifact-badges.js";
import { ArtifactBarActions } from "./artifact-bar-actions.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { DeferredFrame } from "./deferred-frame.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { ShareDialog } from "./share-dialog.js";
import { VersionSwitcher } from "./version-switcher.js";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
  initialEdit?: boolean;
}

export function ArtifactPreviewDialog({
  artifact: initialArtifact,
  onClose,
  initialEdit,
}: Props) {
  const artifact = useArtifact(initialArtifact.id).data ?? initialArtifact;
  const renderable = isRenderedKind(artifact.kind);
  const [fullscreen, setFullscreen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const renameHintId = useId();
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);

  const head = artifact.version;
  const version = pinnedVersion ?? head;

  const { data: versions } = useArtifactVersions(head > 1 ? artifact.id : null);
  const total = versions?.length ?? head;

  const preview = useArtifactPreview(renderable ? artifact.id : null, version);
  const couldEdit = isEditableArtifact(artifact);
  const content = useArtifactContent(
    !renderable || couldEdit ? artifact.id : null,
    version,
  );

  const editor = useArtifactEditor({
    artifact,
    content: content.data,
    isHeadVersion: pinnedVersion === null,
    initialEdit,
  });
  const wantSource = !renderable || editor.editing;
  const startSession = useStartArtifactSession(artifact);

  const { confirmDiscard } = editor;
  const asking = useRef(false);
  const requestClose = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    try {
      if (!(await confirmDiscard())) return;
      onClose();
    } finally {
      asking.current = false;
    }
  }, [confirmDiscard, onClose]);
  const dismiss = useCallback(() => void requestClose(), [requestClose]);

  return (
    <>
      <Modal size="lg" onClose={dismiss}>
        <DialogHeader
          icon={
            <ArtifactVisibilityButton
              artifact={artifact}
              onShare={() => setSharing(true)}
            />
          }
          title={
            <button
              type="button"
              className="max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={artifact.title}
              aria-describedby={renameHintId}
              onClick={() => setRenaming(true)}
            >
              {editor.dirty ? `● ${artifact.title}` : artifact.title}
            </button>
          }
          titleAccessory={
            <span id={renameHintId} hidden>
              Rename artifact
            </span>
          }
          truncateTitle
          actions={
            editor.editing ? (
              <>
                <Button variant="ghost" size="xs" onClick={editor.cancelEdit}>
                  <Close size={14} /> Cancel
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={editor.save}
                  disabled={!editor.dirty || editor.saving}
                  tooltip="Save (Cmd/Ctrl+S)"
                >
                  <Save size={14} /> {editor.saving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-1">
                <VersionSwitcher
                  artifact={artifact}
                  versions={versions}
                  current={version}
                  total={total}
                  onChange={(v) => setPinnedVersion(v === head ? null : v)}
                />
                <ArtifactBarActions
                  artifact={artifact}
                  onEdit={editor.editable ? editor.startEdit : undefined}
                  onShare={() => setSharing(true)}
                  onStartSession={
                    startSession.available && version === head
                      ? () => void startSession.start()
                      : undefined
                  }
                />
                {renderable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Fullscreen"
                    tooltip="Fullscreen"
                    onClick={() => setFullscreen(true)}
                  >
                    <Maximize size={16} />
                  </Button>
                )}
              </div>
            )
          }
          onClose={dismiss}
        />
        <DialogBody>
          <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="truncate">{artifact.fileName}</span>
            <span>·</span>
            <span>{formatBytes(artifact.sizeBytes)}</span>
          </div>

          {!wantSource ? (
            <div className="h-[58vh] w-full overflow-hidden rounded border border-border bg-white">
              {!preview.isLoading && !preview.data ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No preview available.
                </p>
              ) : (
                preview.data && (
                  <DeferredFrame
                    key={version}
                    html={preview.data}
                    title={artifact.title}
                    className="h-full w-full"
                  />
                )
              )}
            </div>
          ) : (
            <div className={editor.editing ? "h-[58vh] overflow-hidden" : ""}>
              <ArtifactSourceView
                artifact={artifact}
                content={content.data}
                isLoading={content.isLoading}
                editMode={editor.editing}
                draft={editor.draft}
                onDraftChange={editor.setDraft}
                onSave={editor.save}
              />
            </div>
          )}
        </DialogBody>
      </Modal>

      {sharing && (
        <ShareDialog artifact={artifact} onClose={() => setSharing(false)} />
      )}

      {renaming && (
        <RenameArtifactDialog
          artifact={artifact}
          onClose={() => setRenaming(false)}
        />
      )}

      {fullscreen && preview.data && (
        <FullscreenPreviewDialog
          title={artifact.title}
          onClose={() => setFullscreen(false)}
        >
          <DeferredFrame
            key={version}
            html={preview.data}
            title={artifact.title}
            className="h-full w-full rounded border border-border bg-white"
            deferMs={0}
          />
        </FullscreenPreviewDialog>
      )}
    </>
  );
}
