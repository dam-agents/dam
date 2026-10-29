import { Information } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { useArtifacts } from "../api/queries.js";
import { ArtifactPreviewDialog } from "./artifact-preview-dialog.js";
import { ArtifactRow } from "./artifact-row.js";
import { MoveArtifactDialog } from "./move-artifact-dialog.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { RetentionDialog } from "./retention-dialog.js";
import { ShareDialog } from "./share-dialog.js";

function ToolChip({ name }: { name: string }) {
  return (
    <code className="rounded bg-muted px-1 py-px font-mono text-xs text-foreground">
      {name}
    </code>
  );
}

const COLLAPSED_LIMIT = 5;

function ArtifactList({
  artifacts,
  onPreview,
  onRename,
  onMove,
  onShare,
  onSetRetention,
}: {
  artifacts: LibraryArtifact[];
  onPreview: (a: LibraryArtifact) => void;
  onRename: (a: LibraryArtifact) => void;
  onMove: (a: LibraryArtifact) => void;
  onShare: (a: LibraryArtifact) => void;
  onSetRetention: (a: LibraryArtifact) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = artifacts.length > COLLAPSED_LIMIT;
  const visible = expanded ? artifacts : artifacts.slice(0, COLLAPSED_LIMIT);

  return (
    <Card className="overflow-hidden">
      <div className="-mt-px">
        {visible.map((artifact) => (
          <ArtifactRow
            key={artifact.id}
            artifact={artifact}
            showAgent={false}
            onPreview={onPreview}
            onRename={onRename}
            onMove={onMove}
            onShare={onShare}
            onSetRetention={onSetRetention}
          />
        ))}
      </div>
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-border px-4 py-2.5 text-center text-sm font-medium text-accent hover:bg-muted/60"
        >
          Expand more ({artifacts.length - COLLAPSED_LIMIT} remaining)
        </button>
      )}
    </Card>
  );
}

export function SandboxArtifactsSection({ agentId }: { agentId: string }) {
  const { data: artifacts = [], isLoading } = useArtifacts({ agentId });
  const [renameTarget, setRenameTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [moveTarget, setMoveTarget] = useState<LibraryArtifact | null>(null);
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);
  const [retentionTarget, setRetentionTarget] =
    useState<LibraryArtifact | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LibraryArtifact | null>(
    null,
  );

  return (
    <section className="mb-8">
      <SectionLabel spaced>Artifacts</SectionLabel>
      <p className="mb-3 text-sm text-muted-foreground">
        Pages and files this agent has published to your artifact library.
      </p>

      <Callout
        tone="info"
        size="sm"
        className="mb-4 flex items-start gap-2.5 text-sm text-muted-foreground"
      >
        <Information size={16} className="mt-0.5 shrink-0 text-accent" />
        <span>
          Agents publish through the built-in platform MCP tools —{" "}
          <ToolChip name="create_artifact" /> for inline content,{" "}
          <ToolChip name="create_artifact_upload_url" /> for direct-to-storage
          uploads. They read artifacts back the same way, with{" "}
          <ToolChip name="create_artifact_download_url" /> to pull any file into
          the sandbox. No extra credentials needed in the sandbox.
        </span>
      </Callout>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : artifacts.length === 0 ? (
        <Card className="px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing published yet — ask the agent to share its work as an
            artifact.
          </p>
        </Card>
      ) : (
        <ArtifactList
          artifacts={artifacts}
          onPreview={setPreviewTarget}
          onRename={setRenameTarget}
          onMove={setMoveTarget}
          onShare={setShareTarget}
          onSetRetention={setRetentionTarget}
        />
      )}

      {renameTarget && (
        <RenameArtifactDialog
          artifact={renameTarget}
          onClose={() => setRenameTarget(null)}
        />
      )}
      {moveTarget && (
        <MoveArtifactDialog
          artifact={moveTarget}
          onClose={() => setMoveTarget(null)}
        />
      )}
      {shareTarget && (
        <ShareDialog
          artifact={shareTarget}
          onClose={() => setShareTarget(null)}
        />
      )}
      {retentionTarget && (
        <RetentionDialog
          artifact={retentionTarget}
          onClose={() => setRetentionTarget(null)}
        />
      )}
      {previewTarget && (
        <ArtifactPreviewDialog
          artifact={previewTarget}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </section>
  );
}
