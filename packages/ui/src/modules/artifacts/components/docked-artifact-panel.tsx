import {
  ChevronLeft,
  Close,
  Download,
  Edit,
  Launch,
  NewTab,
  Save,
  Share,
} from "@carbon/icons-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import {
  useArtifact,
  useArtifactContent,
  useArtifactPreview,
  useArtifactVersions,
} from "../api/queries.js";
import { useArtifactEditor } from "../hooks/use-artifact-editor.js";
import { useStartArtifactSession } from "../hooks/use-start-artifact-session.js";
import { canUseArtifactBridge } from "../lib/artifact-bridge.js";
import { isEditableArtifact } from "../lib/editable.js";
import { isRenderedKind } from "../lib/kinds.js";
import { downloadArtifact } from "../lib/transfer.js";
import { ArtifactVisibilityButton } from "./artifact-badges.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { CopyLinkButton } from "./copy-link-button.js";
import { DeferredFrame } from "./deferred-frame.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { ShareDialog } from "./share-dialog.js";
import { VersionSwitcher } from "./version-switcher.js";

interface Props {
  agentId: string | null;
  onSendPrompt?: (prompt: string) => Promise<void>;
}

export function DockedArtifactPanel({ agentId, onSendPrompt }: Props) {
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
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
    setOpenArtifactId(null);
  }, [confirmDiscard, setOpenArtifactId]);

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
  const frame =
    artifact && preview.data ? (
      <DeferredFrame
        key={`${artifact.id}@${shownVersion}`}
        html={preview.data}
        title={artifact.title}
        className="h-full w-full bg-white"
        deferMs={0}
        onSendPrompt={bridgeOpen ? onSendPrompt : undefined}
        agentApiArtifactId={bridgeOpen ? artifact.id : undefined}
      />
    ) : null;
  const frameFallback = (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {preview.isLoading ? "Loading preview…" : "No preview available."}
    </p>
  );

  if (!openArtifactId) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pl-2 pr-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Back to artifacts"
          tooltip="Back to artifacts"
          onClick={() => void closePanel()}
        >
          <ChevronLeft size={16} />
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
              variant="outline"
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
            {editor.editable && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit"
                tooltip="Edit"
                onClick={editor.startEdit}
              >
                <Edit size={16} />
              </Button>
            )}
            {artifact && (
              <>
                {artifact.shareUrl && (
                  <CopyLinkButton
                    url={artifact.shareUrl}
                    variant="ghost"
                    restricted={artifact.visibility === "restricted"}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Share"
                  tooltip="Share"
                  onClick={() => setShareOpen(true)}
                >
                  <Share size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Download"
                  tooltip="Download"
                  onClick={() => void downloadArtifact(artifact.id)}
                >
                  <Download size={16} />
                </Button>
                {artifact.shareUrl && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Open in new tab"
                    tooltip="Open in new tab"
                    asChild
                  >
                    <a
                      href={artifact.shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Launch size={16} />
                    </a>
                  </Button>
                )}
              </>
            )}
            {startSession.available && shownVersion === latest && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Start a new session"
                tooltip="Start a new session"
                onClick={() => void startSession.start()}
              >
                <NewTab size={16} />
              </Button>
            )}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {artifactError ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-sm text-muted-foreground">
              Couldn't load the artifact.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchArtifact()}
            >
              Retry
            </Button>
          </div>
        ) : artifactPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : !artifact ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Artifact not found — it may have been deleted.
          </p>
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
