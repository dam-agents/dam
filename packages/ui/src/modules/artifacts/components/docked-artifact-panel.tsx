import { ArrowLeft, Close, Save } from "@carbon/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadFailed, PanelMessage } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { SidePanelCloseButton } from "../../sessions/components/side-panel-close-button.js";
import {
  useArtifact,
  useArtifactContent,
  useArtifactPreview,
  useArtifactVersions,
} from "../api/queries.js";
import { useArtifactEditor } from "../hooks/use-artifact-editor.js";
import { useFullPage } from "../hooks/use-full-page.js";
import { useArtifactSessionPrompt } from "../hooks/use-artifact-session-prompt.js";
import { useStartArtifactSession } from "../hooks/use-start-artifact-session.js";
import {
  canStartArtifactSession,
  canUseArtifactBridge,
} from "../lib/artifact-bridge.js";
import { isEditableArtifact } from "../lib/editable.js";
import { isRenderedKind } from "../lib/kinds.js";
import { ArtifactVisibilityButton } from "./artifact-badges.js";
import { ArtifactBarActions } from "./artifact-bar-actions.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { DeferredFrame } from "./deferred-frame.js";
import { FullPageButton } from "./full-page-button.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { ShareDialog } from "./share-dialog.js";
import { VersionSwitcher } from "./version-switcher.js";

interface Props {
  agentId: string | null;
  onSendPrompt?: (prompt: string) => Promise<void>;
}

export function DockedArtifactPanel({ agentId, onSendPrompt }: Props) {
  const openArtifactId = useStore((s) =>
    s.dock?.kind === "artifact" ? s.dock.id : null,
  );
  const setDock = useStore((s) => s.setDock);
  const openArtifactEdit = useStore((s) => s.openArtifactEdit);
  const setOpenArtifactEdit = useStore((s) => s.setOpenArtifactEdit);
  const setOpenArtifactDirty = useStore((s) => s.setOpenArtifactDirty);
  const {
    data: artifact,
    isPending: artifactPending,
    isError: artifactError,
    refetch: refetchArtifact,
  } = useArtifact(openArtifactId);
  const enabled =
    useFeatures(artifact?.interactive === true).data?.[
      "interactive-artifacts"
    ] ?? false;

  const renderable = artifact ? isRenderedKind(artifact.kind) : false;
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { fullPage, toggleFullPage } = useFullPage(rootRef);

  const { data: versions } = useArtifactVersions(openArtifactId);
  const latest = artifact?.version;
  const total = versions?.length ?? latest ?? 1;
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);
  const shownVersion = pinnedVersion ?? latest;

  const couldEdit = !!artifact && isEditableArtifact(artifact);
  const content = useArtifactContent(
    artifact && (!renderable || couldEdit) ? artifact.id : null,
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

  const { confirmDiscard } = editor;
  useEffect(() => {
    setOpenArtifactDirty(editor.dirty);
    return () => setOpenArtifactDirty(false);
  }, [editor.dirty, setOpenArtifactDirty]);

  const closePanel = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    setDock(null);
  }, [confirmDiscard, setDock]);

  const showFrame = renderable && !editor.editing;
  const preview = useArtifactPreview(
    showFrame && artifact ? artifact.id : null,
    shownVersion,
  );
  const startSession = useStartArtifactSession(artifact);

  const bridgeOpen = canUseArtifactBridge(
    artifact,
    enabled,
    agentId,
    shownVersion,
  );
  const sessionPrompt = useArtifactSessionPrompt(
    agentId === null && canStartArtifactSession(artifact, enabled, shownVersion)
      ? artifact?.id
      : undefined,
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

  if (!openArtifactId) return null;

  return (
    <div
      ref={rootRef}
      data-full-page={fullPage || undefined}
      className={cn(
        "flex h-full flex-col",
        fullPage && "fixed inset-0 z-overlay bg-background",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pl-2 pr-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Back to artifacts"
          tooltip="Back to artifacts"
          onClick={() => void closePanel()}
        >
          <ArrowLeft size={16} />
        </Button>
        {artifact && (
          <ArtifactVisibilityButton
            artifact={artifact}
            onShare={() => setShareOpen(true)}
          />
        )}
        <button
          type="button"
          className="min-w-0 truncate rounded-sm text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          title={artifact?.title}
          aria-label={artifact ? `Rename ${artifact.title}` : undefined}
          disabled={!artifact}
          onClick={() => setRenameOpen(true)}
        >
          {editor.dirty ? "\u25cf " : ""}
          {artifact?.title ?? "Artifact"}
        </button>
        <span className="flex-1" />
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
          <>
            {shownVersion !== undefined && artifact && (
              <VersionSwitcher
                artifact={artifact}
                versions={versions}
                current={shownVersion}
                total={total}
                onChange={(v) => setPinnedVersion(v === latest ? null : v)}
              />
            )}
            {artifact && (
              <ArtifactBarActions
                artifact={artifact}
                onEdit={editor.editable ? editor.startEdit : undefined}
                onShare={() => setShareOpen(true)}
                onStartSession={
                  startSession.available && shownVersion === latest
                    ? startSession.start
                    : undefined
                }
              />
            )}
          </>
        )}
        <FullPageButton fullPage={fullPage} onToggle={toggleFullPage} />
        <SidePanelCloseButton />
      </div>

      <div className="min-h-0 flex-1">
        {artifactError ? (
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

      {shareOpen && artifact && (
        <ShareDialog artifact={artifact} onClose={() => setShareOpen(false)} />
      )}

      {renameOpen && artifact && (
        <RenameArtifactDialog
          artifact={artifact}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </div>
  );
}
