import type { LibraryArtifact } from "api-server-api";
import { Code, Download, ExternalLink, Eye, Maximize2 } from "lucide-react";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";

import { FullscreenPreviewDialog } from "../../files/components/fullscreen-preview-dialog.js";
import {
  useArtifactContent,
  useArtifactPreview,
  useArtifactVersions,
} from "../api/queries.js";
import { formatBytes } from "../lib/format.js";
import { isRenderedKind } from "../lib/kinds.js";
import { downloadArtifact } from "../lib/transfer.js";
import { ArtifactSourceView } from "./artifact-source-view.js";
import { DeferredFrame } from "./deferred-frame.js";
import { VersionSwitcher } from "./version-switcher.js";

interface Props {
  artifact: LibraryArtifact;
  onClose: () => void;
}

/** In-app preview: rendered by default for HTML/JSX/markdown — the same
 *  inner document the share page serves, hosted in a sandboxed iframe (see
 *  DeferredFrame). Code/text show highlighted source; images inline; other
 *  binaries offer a download. */
export function ArtifactPreviewDialog({ artifact, onClose }: Props) {
  const renderable = isRenderedKind(artifact.kind);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [version, setVersion] = useState(artifact.version);

  // Version history only matters for multi-version artifacts.
  const { data: versions } = useArtifactVersions(
    artifact.version > 1 ? artifact.id : null,
  );
  const total = versions?.length ?? artifact.version;

  const preview = useArtifactPreview(renderable ? artifact.id : null, version);
  // Source is fetched lazily — only for non-renderable kinds, or once the
  // user flips the toggle.
  const wantSource = !renderable || showSource;
  const content = useArtifactContent(wantSource ? artifact.id : null, version);

  return (
    <>
      <Modal widthClass="w-[860px]">
        <DialogHeader>{artifact.title}</DialogHeader>
        <DialogBody>
          <div className="mb-3 flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
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
                  {showSource ? <Eye size={14} /> : <Code size={14} />}
                  {showSource ? "Preview" : "Source"}
                </Button>
                {!showSource && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Fullscreen"
                    onClick={() => setFullscreen(true)}
                  >
                    <Maximize2 size={16} />
                  </Button>
                )}
              </>
            )}
          </div>

          {renderable && !showSource ? (
            // Fixed-height shell: the dialog never resizes when the frame
            // arrives, so the open animation has nothing to fight.
            <div className="h-[58vh] w-full overflow-hidden rounded border border-border bg-white">
              {!preview.isLoading && !preview.data ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
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
            <ArtifactSourceView
              artifact={artifact}
              content={content.data}
              isLoading={content.isLoading}
            />
          )}
        </DialogBody>
        <DialogFooter>
          {artifact.shareUrl && (
            <Button variant="outline" asChild>
              <a href={artifact.shareUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
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
          <Button variant="ghost" onClick={onClose}>
            Close
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
          />
        </FullscreenPreviewDialog>
      )}
    </>
  );
}
