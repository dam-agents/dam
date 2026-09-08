import {
  Close,
  Code,
  Download,
  Edit,
  Maximize,
  Save,
  Share,
  View,
} from "@carbon/icons-react";
import { INLINE_CONTENT_MAX_BYTES } from "api-server-api";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useDashboardFeedPost } from "../../experiments/hooks/use-dashboard-feed-post.js";
import { FullscreenPreviewDialog } from "../../files/components/fullscreen-preview-dialog.js";
import {
  useArtifact,
  useArtifactContent,
  useArtifactPreview,
  useArtifactVersions,
} from "../api/queries.js";
import { useArtifactEditor } from "../hooks/use-artifact-editor.js";
import { isRenderedKind, isTextKind } from "../lib/kinds.js";
import { downloadArtifact } from "../lib/transfer.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { DeferredFrame } from "./deferred-frame.js";
import { ShareDialog } from "./share-dialog.js";
import { VersionSwitcher } from "./version-switcher.js";

export function DockedArtifactPanel() {
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

  const renderable = artifact ? isRenderedKind(artifact.kind) : false;
  const [showSource, setShowSource] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const { data: versions } = useArtifactVersions(openArtifactId);
  const latest = artifact?.version;
  const total = versions?.length ?? latest ?? 1;
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);
  const shownVersion = pinnedVersion ?? latest;

  const couldEdit =
    !!artifact &&
    isTextKind(artifact.kind) &&
    artifact.sizeBytes <= INLINE_CONTENT_MAX_BYTES;
  const content = useArtifactContent(
    artifact && (!renderable || showSource || couldEdit) ? artifact.id : null,
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

  const showFrame = renderable && !showSource && !editor.editing;
  const preview = useArtifactPreview(
    showFrame && artifact ? artifact.id : null,
    shownVersion,
  );
  const experimentFeedPost = useDashboardFeedPost(openArtifactId);
  const feedPostForShown =
    shownVersion === latest ? experimentFeedPost : undefined;

  const frame =
    artifact && preview.data ? (
      <DeferredFrame
        key={`${artifact.id}@${shownVersion}`}
        html={preview.data}
        title={artifact.title}
        className="h-full w-full bg-white"
        deferMs={0}
        postData={feedPostForShown}
      />
    ) : null;
  const frameFallback = (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {preview.isLoading ? "Loading preview…" : "No preview available."}
    </p>
  );
  const frameShowing = showFrame && frame !== null;
  const expanded = fullscreen && showFrame;

  if (!openArtifactId) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          title={artifact?.title}
        >
          {editor.dirty ? "\u25cf " : ""}
          {artifact?.title ?? "Artifact"}
        </span>
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
              <Button variant="outline" size="xs" onClick={editor.startEdit}>
                <Edit size={14} /> Edit
              </Button>
            )}
            {artifact && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setShareOpen(true)}
              >
                <Share size={14} />
                Share
              </Button>
            )}
            {renderable && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setShowSource((s) => !s)}
              >
                {showSource ? <View size={14} /> : <Code size={14} />}
                {showSource ? "Preview" : "Source"}
              </Button>
            )}
            {artifact && (
              <Button
                variant="outline"
                size="icon-xs"
                aria-label="Download"
                tooltip="Download"
                onClick={() => void downloadArtifact(artifact.id)}
              >
                <Download size={14} />
              </Button>
            )}
            {frameShowing && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open fullscreen"
                tooltip="Open fullscreen"
                onClick={() => setFullscreen(true)}
              >
                <Maximize size={16} />
              </Button>
            )}
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={() => void closePanel()}
        >
          <Close size={16} />
        </Button>
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
          expanded ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Opened in fullscreen
            </div>
          ) : (
            (frame ?? frameFallback)
          )
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

      {expanded && artifact && (
        <FullscreenPreviewDialog
          title={artifact.title}
          onClose={() => setFullscreen(false)}
        >
          {frame ?? frameFallback}
        </FullscreenPreviewDialog>
      )}
    </div>
  );
}
