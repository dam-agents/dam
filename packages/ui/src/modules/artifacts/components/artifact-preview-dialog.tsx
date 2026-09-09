import { Code, Download, Maximize, Share, View } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-size";

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
import { ArtifactStatusBadge } from "./artifact-badges.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { CopyLinkButton } from "./copy-link-button.js";
import { DeferredFrame } from "./deferred-frame.js";
import { ShareDialog } from "./share-dialog.js";
import { VersionSwitcher } from "./version-switcher.js";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

export function ArtifactPreviewDialog({
  artifact: initialArtifact,
  onClose,
}: Props) {
  const artifact = useArtifact(initialArtifact.id).data ?? initialArtifact;
  const renderable = isRenderedKind(artifact.kind);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [version, setVersion] = useState(initialArtifact.version);

  const { data: versions } = useArtifactVersions(
    artifact.version > 1 ? artifact.id : null,
  );
  const total = versions?.length ?? artifact.version;

  const preview = useArtifactPreview(renderable ? artifact.id : null, version);
  const latestFeedPost = useDashboardFeedPost(artifact.id);
  const experimentFeedPost =
    version === artifact.version ? latestFeedPost : undefined;
  const wantSource = !renderable || showSource;
  const content = useArtifactContent(wantSource ? artifact.id : null, version);

  return (
    <>
      <Modal widthClass="w-[860px]" onClose={onClose}>
        <DialogHeader title={artifact.title} onClose={onClose} />
        <DialogBody>
          <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <ArtifactStatusBadge artifact={artifact} />
            <span className="truncate">{artifact.fileName}</span>
            <span>·</span>
            <span>{formatBytes(artifact.sizeBytes)}</span>
            <span className="flex-1" />
            <VersionSwitcher
              current={version}
              total={total}
              onChange={setVersion}
            />
            {artifact.shareUrl && (
              <CopyLinkButton url={artifact.shareUrl} variant="outline" />
            )}
            {renderable && (
              <>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setShowSource((s) => !s)}
                >
                  {showSource ? <View size={14} /> : <Code size={14} />}
                  {showSource ? "Preview" : "Source"}
                </Button>
                {!showSource && (
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Fullscreen"
                    tooltip="Fullscreen"
                    onClick={() => setFullscreen(true)}
                  >
                    <Maximize size={14} />
                  </Button>
                )}
              </>
            )}
          </div>

          {renderable && !showSource ? (
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
                    postData={experimentFeedPost}
                  />
                )
              )}
            </div>
          ) : (
            <ArtifactSourceView
              artifact={artifact}
              content={content.data}
              isLoading={content.isLoading}
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSharing(true)}>
            <Share size={16} />
            Share
          </Button>
          <Button
            variant="outline"
            onClick={() => void downloadArtifact(artifact.id)}
          >
            <Download size={16} />
            Download
          </Button>
        </DialogFooter>
      </Modal>

      {sharing && (
        <ShareDialog artifact={artifact} onClose={() => setSharing(false)} />
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
