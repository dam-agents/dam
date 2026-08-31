import { Code, Download, Launch, Maximize, View } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";
import { formatBytes } from "@/lib/format-size";

import { useDashboardFeedPost } from "../../experiments/hooks/use-dashboard-feed-post.js";
import { FullscreenPreviewDialog } from "../../files/components/fullscreen-preview-dialog.js";
import {
  useArtifactContent,
  useArtifactPreview,
  useArtifactVersions,
} from "../api/queries.js";
import { useArtifactBridge } from "../hooks/use-artifact-bridge.js";
import { isRenderedKind } from "../lib/kinds.js";
import { downloadArtifact } from "../lib/transfer.js";
import { ArtifactRequestStatusBar } from "./artifact-request-status-bar.js";
import { ArtifactSessionButton } from "./artifact-session-button.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { DeferredFrame } from "./deferred-frame.js";
import { VersionSwitcher } from "./version-switcher.js";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

export function ArtifactPreviewDialog({ artifact, onClose }: Props) {
  const renderable = isRenderedKind(artifact.kind);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [version, setVersion] = useState(artifact.version);

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
  const {
    bridge,
    status: requestStatus,
    dismissFailure,
  } = useArtifactBridge(version === artifact.version ? artifact : null);

  return (
    <>
      <Modal widthClass="w-[860px]">
        <DialogHeader title={artifact.title} onClose={onClose} />
        <DialogBody>
          <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="truncate">{artifact.fileName}</span>
            <span>·</span>
            <span>{formatBytes(artifact.sizeBytes)}</span>
            <span className="flex-1" />
            <VersionSwitcher
              current={version}
              total={total}
              onChange={setVersion}
            />
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
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Fullscreen"
                    tooltip="Fullscreen"
                    onClick={() => setFullscreen(true)}
                  >
                    <Maximize size={16} />
                  </Button>
                )}
              </>
            )}
          </div>

          <ArtifactRequestStatusBar
            status={requestStatus}
            onDismissFailure={dismissFailure}
            className="mb-2 rounded border border-border"
          />

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
                    bridge={fullscreen ? undefined : bridge}
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
          <ArtifactSessionButton artifact={artifact} onOpened={onClose} />
          {artifact.shareUrl && (
            <Button variant="outline" asChild>
              <a href={artifact.shareUrl} {...externalLinkProps}>
                <Launch size={16} />
                Open share page
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void downloadArtifact(artifact.id)}
          >
            <Download size={16} />
            Download
          </Button>
        </DialogFooter>
      </Modal>

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
            bridge={bridge}
          />
        </FullscreenPreviewDialog>
      )}
    </>
  );
}
