import { Close, Code, Download, Share, View } from "@carbon/icons-react";
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

export function DockedArtifactPanel() {
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const {
    data: artifact,
    isPending: artifactPending,
    isError: artifactError,
    refetch: refetchArtifact,
  } = useArtifact(openArtifactId);

  const renderable = artifact ? isRenderedKind(artifact.kind) : false;
  const [showSource, setShowSource] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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

  if (!openArtifactId) return null;

  return (
    <div className="flex h-full flex-col">
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
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
          preview.data ? (
            <DeferredFrame
              key={`${artifact.id}@${shownVersion}`}
              html={preview.data}
              title={artifact.title}
              className="h-full w-full bg-white"
              deferMs={0}
              postData={feedPostForShown}
            />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
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
