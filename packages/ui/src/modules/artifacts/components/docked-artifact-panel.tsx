import {
  Calendar,
  ChatBot,
  Close,
  Code,
  Download,
  Edit,
  FolderMoveTo,
  Launch,
  Locked,
  OverflowMenuVertical,
  TrashCan,
  View,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useDashboardFeedPost } from "../../experiments/hooks/use-dashboard-feed-post.js";
import { FullscreenPreviewDialog } from "../../files/components/fullscreen-preview-dialog.js";
import {
  useArtifact,
  useArtifactContent,
  useArtifactPreview,
  useArtifactVersions,
} from "../api/queries.js";
import { isRenderedKind } from "../lib/kinds.js";
import { downloadArtifact } from "../lib/transfer.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { DeferredFrame } from "./deferred-frame.js";
import { ShareDialog } from "./share-dialog.js";
import { VersionSwitcher } from "./version-switcher.js";

export function DockedArtifactPanel() {
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const showConfirm = useStore((s) => s.showConfirm);
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
  const showFrame = renderable && !showSource;

  const { data: versions } = useArtifactVersions(openArtifactId);
  const latest = artifact?.version;
  const total = versions?.length ?? latest ?? 1;
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);
  const shownVersion = pinnedVersion ?? latest;

  const preview = useArtifactPreview(
    showFrame && artifact ? artifact.id : null,
    shownVersion,
  );
  const content = useArtifactContent(
    artifact && !showFrame ? artifact.id : null,
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

  async function handleDelete() {
    const confirmed = await showConfirm(
      "This will permanently delete the artifact.",
      "Delete artifact",
      { kind: "destructive" },
    );
    if (!confirmed) return;
    setOpenArtifactId(null);
    emitToast({
      kind: "success",
      message: `Deleted "${artifact?.title ?? "artifact"}".`,
    });
  }

  if (!openArtifactId) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          title={artifact?.title}
        >
          {artifact?.title ?? "Artifact"}
        </span>
        {shownVersion !== undefined && (
          <VersionSwitcher
            current={shownVersion}
            total={total}
            onChange={(v) => setPinnedVersion(v === latest ? null : v)}
          />
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1 text-xs text-muted-foreground"
          onClick={() => setShareOpen(true)}
        >
          <Locked size={12} />
          Private
        </Button>
        {artifact && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label="Download"
            tooltip="Download"
            onClick={() => void downloadArtifact(artifact.id)}
          >
            <Download size={16} />
          </Button>
        )}
        {frameShowing && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label="Open fullscreen"
            tooltip="Open fullscreen"
            onClick={() => setFullscreen(true)}
          >
            <Launch size={16} />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label="More actions"
            >
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                emitToast({
                  kind: "info",
                  message: "Ask agent to edit (placeholder)",
                })
              }
            >
              <ChatBot size={13} /> Ask agent to edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                emitToast({ kind: "info", message: "Rename (placeholder)" })
              }
            >
              <Edit size={13} /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                emitToast({ kind: "info", message: "Move (placeholder)" })
              }
            >
              <FolderMoveTo size={13} /> Move
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {renderable && (
              <DropdownMenuItem onSelect={() => setShowSource((s) => !s)}>
                {showSource ? <View size={13} /> : <Code size={13} />}
                {showSource ? "Preview" : "View source"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                emitToast({
                  kind: "info",
                  message: "Set expiration (placeholder)",
                })
              }
            >
              <Calendar size={13} /> Set expiration
            </DropdownMenuItem>
            <DropdownMenuItem tone="danger" onSelect={handleDelete}>
              <TrashCan size={13} /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Close"
          tooltip="Close"
          onClick={() => setOpenArtifactId(null)}
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
          <div className="h-full overflow-auto p-4">
            <ArtifactSourceView
              artifact={artifact}
              content={content.data}
              isLoading={content.isLoading}
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
