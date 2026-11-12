import { ArrowLeft, Close, Save } from "@carbon/icons-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadFailed, PanelMessage } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  useArtifact,
  useArtifactContent,
  useArtifactPreview,
  useArtifactVersions,
} from "../api/queries.js";
import { useArtifactEditor } from "../hooks/use-artifact-editor.js";
import { useArtifactSessionPrompt } from "../hooks/use-artifact-session-prompt.js";
import { useConfirmDeleteArtifact } from "../hooks/use-confirm-delete-artifact.js";
import { useStartArtifactSession } from "../hooks/use-start-artifact-session.js";
import {
  canStartArtifactSession,
  canUseArtifactBridge,
} from "../lib/artifact-bridge.js";
import { isEditableArtifact } from "../lib/editable.js";
import { isRenderedKind } from "../lib/kinds.js";
import { artifactMissing } from "../lib/load-failure.js";
import { ArtifactIcon } from "./artifact-badges.js";
import {
  ArtifactBarActions,
  ArtifactPanelMenu,
  ArtifactShareButton,
} from "./artifact-bar-actions.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { DeferredFrame } from "./deferred-frame.js";
import { MoveArtifactDialog } from "./move-artifact-dialog.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { RetentionDialog } from "./retention-dialog.js";
import { ShareDialog } from "./share-dialog.js";
import { VersionSwitcher } from "./version-switcher.js";

type ArtifactDialog = "share" | "rename" | "move" | "retention";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One artifact with its top bar: the title, the
 * version switcher, Share with the current visibility, Download, Open in new
 * tab and a ⋮ menu for the rest. The side panel docks it beside a page or a
 * chat, and the artifact page shows it alone in its own browser tab, so both
 * places offer the same actions. `onBack` and `close` are the side panel's;
 * the artifact page has neither, and as it already fills its tab it offers no
 * Open in new tab.
 */
export function ArtifactPanel({
  artifactId,
  agentId,
  onSendPrompt,
  onBack,
  close,
  standalone = false,
}: {
  artifactId: string;
  agentId: string | null;
  onSendPrompt?: (prompt: string) => Promise<void>;
  onBack?: () => void;
  close?: ReactNode;
  standalone?: boolean;
}) {
  const openArtifactEdit = useStore((s) => s.openArtifactEdit);
  const setOpenArtifactEdit = useStore((s) => s.setOpenArtifactEdit);
  const setOpenArtifactDirty = useStore((s) => s.setOpenArtifactDirty);
  const {
    data: artifact,
    isPending: artifactPending,
    isError: artifactError,
    error: artifactFailure,
    refetch: refetchArtifact,
  } = useArtifact(artifactId);

  const renderable = artifact ? isRenderedKind(artifact.kind) : false;
  const [dialog, setDialog] = useState<ArtifactDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const [source, setSource] = useState(false);

  const { data: versions } = useArtifactVersions(artifactId);
  const latest = artifact?.version;
  const total = versions?.length ?? latest ?? 1;
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);
  const shownVersion = pinnedVersion ?? latest;

  const couldEdit = !!artifact && isEditableArtifact(artifact);
  const content = useArtifactContent(
    artifact && (!renderable || couldEdit || source) ? artifact.id : null,
    shownVersion,
  );
  const editor = useArtifactEditor({
    artifact,
    content: content.data,
    isHeadVersion: pinnedVersion === null,
    initialEdit: openArtifactEdit,
    onEditConsumed: useCallback(
      () => setOpenArtifactEdit(false),
      [setOpenArtifactEdit],
    ),
  });

  useEffect(() => {
    setOpenArtifactDirty(editor.dirty);
    return () => setOpenArtifactDirty(false);
  }, [editor.dirty, setOpenArtifactDirty]);

  const showFrame = renderable && !source && !editor.editing;
  const preview = useArtifactPreview(
    showFrame && artifact ? artifact.id : null,
    shownVersion,
  );
  const startSession = useStartArtifactSession(artifact);
  const confirmDelete = useConfirmDeleteArtifact();

  const bridgeOpen = canUseArtifactBridge(artifact, agentId, shownVersion);
  const sessionPrompt = useArtifactSessionPrompt(
    canStartArtifactSession(artifact, shownVersion) ? artifact?.id : undefined,
  );
  const frame =
    artifact && preview.data ? (
      <DeferredFrame
        key={`${artifact.id}@${shownVersion}`}
        html={preview.data}
        title={artifact.title}
        className="h-full w-full bg-white"
        deferMs={0}
        onSendPrompt={bridgeOpen ? onSendPrompt : undefined}
        onNewSessionPrompt={sessionPrompt}
        agentApiArtifactId={bridgeOpen ? artifact.id : undefined}
      />
    ) : null;
  const frameFallback = (
    <PanelMessage>
      {preview.isLoading ? "Loading preview…" : "No preview available."}
    </PanelMessage>
  );

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 border-b border-border pr-4",
          onBack ? "pl-2" : "pl-4",
        )}
      >
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label="Back to artifacts"
            tooltip="Back to artifacts"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          title={artifact?.title}
        >
          {editor.dirty ? "● " : ""}
          {artifact?.icon && (
            <ArtifactIcon icon={artifact.icon} className="mr-1.5" />
          )}
          {artifact?.title ?? "Artifact"}
        </span>
        {editor.editing ? (
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
          artifact && (
            <>
              {shownVersion !== undefined && (
                <VersionSwitcher
                  artifact={artifact}
                  versions={versions}
                  current={shownVersion}
                  total={total}
                  onChange={(v) => setPinnedVersion(v === latest ? null : v)}
                />
              )}
              <ArtifactShareButton
                artifact={artifact}
                onShare={() => setDialog("share")}
              />
              <ArtifactBarActions artifact={artifact} newTab={!standalone} />
              <ArtifactPanelMenu
                onRename={() => setDialog("rename")}
                onMove={() => setDialog("move")}
                onEdit={
                  editor.editable
                    ? () => {
                        setSource(false);
                        editor.startEdit();
                      }
                    : undefined
                }
                onStartSession={
                  startSession.available && shownVersion === latest
                    ? startSession.start
                    : undefined
                }
                source={source}
                onToggleSource={
                  renderable ? () => setSource((s) => !s) : undefined
                }
                onSetRetention={() => setDialog("retention")}
                onDelete={() => void confirmDelete(artifact)}
              />
            </>
          )
        )}
        {close}
      </div>

      <div className="min-h-0 flex-1">
        {artifactError && !artifactMissing(artifactFailure) ? (
          <LoadFailed
            what="Couldn't load the artifact."
            onRetry={() => refetchArtifact()}
          />
        ) : artifactPending ? (
          <PanelMessage>Loading…</PanelMessage>
        ) : !artifact ? (
          <PanelMessage>
            Artifact not found — it may have been deleted.
          </PanelMessage>
        ) : showFrame ? (
          (frame ?? frameFallback)
        ) : (
          <div
            className={
              editor.editing
                ? "h-full overflow-hidden p-2"
                : "h-full overflow-auto p-4"
            }
          >
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
      </div>

      {artifact &&
        dialog !== null &&
        {
          share: <ShareDialog artifact={artifact} onClose={closeDialog} />,
          rename: (
            <RenameArtifactDialog artifact={artifact} onClose={closeDialog} />
          ),
          move: (
            <MoveArtifactDialog artifact={artifact} onClose={closeDialog} />
          ),
          retention: (
            <RetentionDialog artifact={artifact} onClose={closeDialog} />
          ),
        }[dialog]}
    </div>
  );
}
