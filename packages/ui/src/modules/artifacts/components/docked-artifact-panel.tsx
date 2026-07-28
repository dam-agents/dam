import { Code, Download, Eye, Share2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useDashboardFeedPost } from "../../experiments/hooks/use-dashboard-feed-post.js";
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

/** How often the docked artifact tracks new versions — an agent publishing
 *  mid-conversation swaps the preview in near-real-time. */
const LIVE_POLL_MS = 5000;

/** Right-dock artifact preview for the chat view — the artifact counterpart
 *  of DockedFilePanel. Live: polls the artifact and re-renders when a new
 *  version lands (the preview query is keyed by version). */
export function DockedArtifactPanel() {
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const { data: artifact } = useArtifact(openArtifactId, {
    refetchIntervalMs: LIVE_POLL_MS,
  });

  const renderable = artifact ? isRenderedKind(artifact.kind) : false;
  const [showSource, setShowSource] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const showFrame = renderable && !showSource;

  const { data: versions } = useArtifactVersions(openArtifactId, {
    refetchIntervalMs: LIVE_POLL_MS,
  });
  const latest = artifact?.version;
  const total = versions?.length ?? latest ?? 1;
  // null = follow the latest version live; a number pins to that version.
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
  // Only the LATEST version gets the live feed: a pinned older version must
  // render exactly its baked state, or the version history is meaningless
  // (the live push always outruns the baked replay).
  const feedPostForShown =
    shownVersion === latest ? experimentFeedPost : undefined;

  if (!openArtifactId) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[48px] shrink-0 items-center gap-2 border-b border-border-light px-4">
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
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
        {artifact && (
          <Button
            variant="outline"
            size="xs"
            title="Sharing settings"
            onClick={() => setShareOpen(true)}
          >
            <Share2 size={14} />
            Share
          </Button>
        )}
        {renderable && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => setShowSource((s) => !s)}
          >
            {showSource ? <Eye size={14} /> : <Code size={14} />}
            {showSource ? "Preview" : "Source"}
          </Button>
        )}
        {artifact && (
          <Button
            variant="outline"
            size="icon-xs"
            title="Download"
            onClick={() => void downloadArtifact(artifact.id)}
          >
            <Download size={14} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Close"
          onClick={() => setOpenArtifactId(null)}
        >
          <X size={16} />
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {!artifact ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            Artifact not found — it may have been deleted.
          </p>
        ) : showFrame ? (
          preview.data ? (
            <DeferredFrame
              // Remount per shown version so a switch/live update swaps cleanly.
              key={`${artifact.id}@${shownVersion}`}
              html={preview.data}
              title={artifact.title}
              className="h-full w-full bg-white"
              deferMs={0}
              postData={feedPostForShown}
            />
          ) : (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              {preview.isLoading ? "Loading preview…" : "No preview available."}
            </p>
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
    </div>
  );
}
