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
import { useArtifactEditor } from "../hooks/use-artifact-editor.js";
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
  initialEdit?: boolean;
}

export function ArtifactPreviewDialog({
  artifact: initialArtifact,
  onClose,
  initialEdit,
}: Props) {
  const artifact = useArtifact(initialArtifact.id).data ?? initialArtifact;
  const renderable = isRenderedKind(artifact.kind);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);

  const head = artifact.version;
  const version = pinnedVersion ?? head;

  const { data: versions } = useArtifactVersions(head > 1 ? artifact.id : null);
  const total = versions?.length ?? head;

  const preview = useArtifactPreview(renderable ? artifact.id : null, version);
  const latestFeedPost = useDashboardFeedPost(artifact.id);
  const experimentFeedPost = version === head ? latestFeedPost : undefined;
  const content = useArtifactContent(artifact.id, version);

  const editor = useArtifactEditor({
    artifact,
    content: content.data,
    isHeadVersion: pinnedVersion === null,
    initialEdit,
  });
  const wantSource = !renderable || showSource || editor.editing;

  return (
    <>
      <Modal widthClass="w-[860px]" onClose={onClose}>
        <DialogHeader
          title={editor.dirty ? `● ${artifact.title}` : artifact.title}
          onClose={onClose}
        />
        <DialogBody>
          <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <ArtifactStatusBadge artifact={artifact} />
            <span className="truncate">{artifact.fileName}</span>
            <span>·</span>
            <span>{formatBytes(artifact.sizeBytes)}</span>
            <span className="flex-1" />
            {!editor.editing && (
              <VersionSwitcher
                artifact={artifact}
                versions={versions}
                current={version}
                total={total}
                onChange={(v) => setPinnedVersion(v === head ? null : v)}
              />
            )}
            {artifact.shareUrl && (
              <CopyLinkButton url={artifact.shareUrl} variant="outline" />
            )}
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
                {editor.editable && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={editor.startEdit}
                  >
                    <Edit size={14} /> Edit
                  </Button>
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
              </>
            )}
          </div>

          {!wantSource ? (
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
            <div className={editor.editing ? "h-[58vh] overflow-hidden" : ""}>
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
