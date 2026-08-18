import { Information } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { useArtifacts } from "../api/queries.js";
import { ArtifactPreviewDialog } from "./artifact-preview-dialog.js";
import { ArtifactRow } from "./artifact-row.js";
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

export function SandboxArtifactsSection({ agentId }: { agentId: string }) {
  const { data: artifacts = [], isLoading } = useArtifacts({ agentId });
  const [renameTarget, setRenameTarget] = useState<LibraryArtifact | null>(
    null,
  );
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
        <Card className="overflow-hidden">
          {}
          <div className="-mt-px">
            {artifacts.map((artifact) => (
              <ArtifactRow
                key={artifact.id}
                artifact={artifact}
                showAgent={false}
                onPreview={setPreviewTarget}
                onRename={setRenameTarget}
                onShare={setShareTarget}
                onSetRetention={setRetentionTarget}
              />
            ))}
          </div>
        </Card>
      )}

      {renameTarget && (
        <RenameArtifactDialog
          artifact={renameTarget}
          onClose={() => setRenameTarget(null)}
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
