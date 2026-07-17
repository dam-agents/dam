import type { LibraryArtifact } from "api-server-api";
import { Info } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionLabel } from "@/components/ui/section-label";

import { useDeleteArtifact } from "../api/mutations.js";
import { useArtifacts } from "../api/queries.js";
import { ArtifactPreviewDialog } from "./artifact-preview-dialog.js";
import { ArtifactRow } from "./artifact-row.js";
import { ShareDialog } from "./share-dialog.js";

/** The sandbox-home "Artifacts" section: everything this agent has published
 *  to the owner's library, with the same share/preview/delete actions as the
 *  top-level Artifacts page. */
export function SandboxArtifactsSection({ agentId }: { agentId: string }) {
  const { data: artifacts = [], isLoading } = useArtifacts({ agentId });
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const deleteArtifact = useDeleteArtifact();

  return (
    <section className="mb-8">
      <SectionLabel spaced>Artifacts</SectionLabel>
      <p className="mb-3 text-[14px] text-muted-foreground">
        Pages and files this agent has published to your artifact library.
      </p>

      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-callout-border bg-callout p-3 text-[13px] text-text-secondary">
        <Info size={16} className="mt-0.5 shrink-0 text-accent" />
        <span>
          Agents publish through the built-in platform MCP tools —{" "}
          <code className="rounded bg-muted px-1 py-px font-mono text-[12px] text-foreground">
            create_artifact
          </code>{" "}
          for inline content,{" "}
          <code className="rounded bg-muted px-1 py-px font-mono text-[12px] text-foreground">
            create_artifact_upload_url
          </code>{" "}
          for direct-to-storage uploads. No extra credentials needed in the
          sandbox.
        </span>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : artifacts.length === 0 ? (
        <Card className="px-5 py-8 text-center">
          <p className="text-[14px] text-muted-foreground">
            Nothing published yet — ask the agent to share its work as an
            artifact.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* first-row border-t is hidden by the card edge */}
          <div className="-mt-px">
            {artifacts.map((artifact) => (
              <ArtifactRow
                key={artifact.id}
                artifact={artifact}
                showAgent={false}
                onPreview={setPreviewTarget}
                onShare={setShareTarget}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        </Card>
      )}

      {shareTarget && (
        <ShareDialog
          artifact={shareTarget}
          onClose={() => setShareTarget(null)}
        />
      )}
      {previewTarget && (
        <ArtifactPreviewDialog
          artifact={previewTarget}
          onClose={() => setPreviewTarget(null)}
        />
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        kind="destructive"
        title={`Delete “${deleteTarget?.title}”?`}
        description="All versions are deleted and its share link stops working. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) deleteArtifact.mutate({ id: deleteTarget.id });
          setDeleteTarget(null);
        }}
      />
    </section>
  );
}
