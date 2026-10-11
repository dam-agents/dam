import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import { ListSection } from "@/components/ui/list-section";

import { useArtifactFolders, useArtifacts } from "../api/queries.js";
import { folderDisplayNames } from "../lib/folders.js";
import { groupArtifactsByFolder } from "../lib/group-artifacts.js";
import { ArtifactPreviewDialog } from "./artifact-preview-dialog.js";
import { FolderGroup } from "./folder-group.js";
import { MoveArtifactDialog } from "./move-artifact-dialog.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { RetentionDialog } from "./retention-dialog.js";
import { ShareDialog } from "./share-dialog.js";

export function SandboxArtifactsSection({ agentId }: { agentId: string }) {
  const {
    data: artifacts = [],
    isLoading,
    isError,
  } = useArtifacts({ agentId });
  const { data: folders = [], isPending: foldersPending } =
    useArtifactFolders();
  const folderNames = folderDisplayNames(folders);
  const [renameTarget, setRenameTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [moveTarget, setMoveTarget] = useState<LibraryArtifact | null>(null);
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);
  const [retentionTarget, setRetentionTarget] =
    useState<LibraryArtifact | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{
    artifact: LibraryArtifact;
    edit?: boolean;
  } | null>(null);

  return (
    <>
      <ListSection
        loading={isLoading || foldersPending}
        error={isError && "Couldn't load artifacts."}
        isEmpty={artifacts.length === 0}
        empty="Nothing published yet — ask the agent to share its work as an artifact."
      >
        <div className="-mt-px">
          {groupArtifactsByFolder(artifacts, folders, {
            omitEmptyFolders: true,
          }).map((group) => (
            <FolderGroup
              key={group.key}
              folder={group.folder}
              artifacts={group.artifacts}
              displayName={
                group.folder ? folderNames.get(group.folder.id) : undefined
              }
              nested
              defaultCollapsed={group.artifacts.length === 0}
              showAgent={false}
              onPreview={(artifact) => setPreviewTarget({ artifact })}
              onEdit={(artifact) => setPreviewTarget({ artifact, edit: true })}
              onRename={setRenameTarget}
              onMove={setMoveTarget}
              onShare={setShareTarget}
              onSetRetention={setRetentionTarget}
            />
          ))}
        </div>
      </ListSection>

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
          artifact={previewTarget.artifact}
          onClose={() => setPreviewTarget(null)}
          initialEdit={previewTarget.edit}
        />
      )}
    </>
  );
}
