import { Search } from "@carbon/icons-react";
import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import { EXPERIMENT_FOLDER_PREFIX } from "api-server-api";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatBytes } from "@/lib/format-size";

import { api } from "../../../api.js";
import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useDeleteFolder } from "../api/mutations.js";
import { useArtifactFolders, useArtifacts } from "../api/queries.js";
import { ArtifactPreviewDialog } from "../components/artifact-preview-dialog.js";
import { ExperimentsSection } from "../components/experiments-section.js";
import { FolderDialog } from "../components/folder-dialog.js";
import { FolderGroup } from "../components/folder-group.js";
import { RenameArtifactDialog } from "../components/rename-artifact-dialog.js";
import { RetentionDialog } from "../components/retention-dialog.js";
import { ShareDialog } from "../components/share-dialog.js";
import { UploadArtifactDialog } from "../components/upload-artifact-dialog.js";

const EMPTY_ARTIFACTS: LibraryArtifact[] = [];
const EMPTY_FOLDERS: ArtifactFolder[] = [];

export function ArtifactsView() {
  const { data: artifacts = EMPTY_ARTIFACTS, isLoading: artifactsLoading } =
    useArtifacts();
  const { data: folders = EMPTY_FOLDERS, isLoading: foldersLoading } =
    useArtifactFolders();

  const setView = useStore((s) => s.setView);

  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState<{
    folder: ArtifactFolder | null;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);
  const [retentionTarget, setRetentionTarget] =
    useState<LibraryArtifact | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<ArtifactFolder | null>(null);

  const deleteFolder = useDeleteFolder();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return artifacts;
    return artifacts.filter(
      (a) =>
        a.title.toLowerCase().includes(term) ||
        a.fileName.toLowerCase().includes(term),
    );
  }, [artifacts, search]);

  const byFolder = useMemo(() => {
    const groups = new Map<string | null, LibraryArtifact[]>();
    for (const artifact of filtered) {
      const key = artifact.folderId;
      groups.set(key, [...(groups.get(key) ?? []), artifact]);
    }
    return groups;
  }, [filtered]);

  const totalBytes = useMemo(
    () => artifacts.reduce((sum, a) => sum + a.sizeBytes, 0),
    [artifacts],
  );

  const rowActions = {
    onPreview: setPreviewTarget,
    onRename: setRenameTarget,
    onShare: setShareTarget,
    onSetRetention: setRetentionTarget,
  };

  const copyFolderLink = async (folder: ArtifactFolder) => {
    return api.artifactLibrary.folderShareUrl
      .query({ id: folder.id })
      .then((url) => url ?? null);
  };

  const experimentFolders = folders.filter((f) =>
    f.name.startsWith(EXPERIMENT_FOLDER_PREFIX),
  );
  const userFolders = folders.filter(
    (f) => !f.name.startsWith(EXPERIMENT_FOLDER_PREFIX),
  );

  const ungrouped = byFolder.get(null) ?? [];
  const loading = artifactsLoading || foldersLoading;
  const hasContent = artifacts.length > 0 || folders.length > 0;
  const isEmpty = !loading && !hasContent;

  return (
    <div className="anim-in">
      <PageHeader
        title="Artifacts"
        description={
          hasContent
            ? "Pages and files created by you and your agents. Share with a link, or set them to delete automatically."
            : undefined
        }
        actions={
          hasContent ? (
            <>
              <Button
                variant="outline"
                onClick={() => setFolderDialog({ folder: null })}
              >
                New folder
              </Button>
              <Button onClick={() => setUploadOpen(true)}>
                Upload artifact
              </Button>
            </>
          ) : undefined
        }
      />

      {hasContent && (
        <div className="relative mt-7">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-9"
            placeholder="Search artifacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {}
      {loading && !hasContent && <ListSkeleton rows={2} rowHeight={70} />}

      {isEmpty && (
        <PageEmptyState
          title="No artifacts yet"
          message="Artifacts from every sandbox collect here."
          actionLabel="Go to sandboxes"
          onAction={() => setView("list")}
        />
      )}

      {hasContent && (
        <div className="mt-5 flex flex-col gap-3">
          {userFolders.map((folder) => (
            <FolderGroup
              key={folder.id}
              folder={folder}
              artifacts={byFolder.get(folder.id) ?? []}
              onEditFolder={(f) => setFolderDialog({ folder: f })}
              onDeleteFolder={setDeleteFolderTarget}
              onCopyFolderLink={copyFolderLink}
              {...rowActions}
            />
          ))}
          {ungrouped.length > 0 && (
            <FolderGroup folder={null} artifacts={ungrouped} {...rowActions} />
          )}
          {experimentFolders.length > 0 && (
            <ExperimentsSection
              folders={experimentFolders}
              byFolder={byFolder}
              searching={search.trim().length > 0}
              onEditFolder={(f) => setFolderDialog({ folder: f })}
              onDeleteFolder={setDeleteFolderTarget}
              onCopyFolderLink={copyFolderLink}
              {...rowActions}
            />
          )}
        </div>
      )}

      {artifacts.length > 0 && (
        <p className="mt-5 text-sm text-muted-foreground">
          {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(totalBytes)} stored
        </p>
      )}

      {uploadOpen && (
        <UploadArtifactDialog
          folders={folders}
          onClose={() => setUploadOpen(false)}
        />
      )}
      {folderDialog && (
        <FolderDialog
          folder={folderDialog.folder}
          onClose={() => setFolderDialog(null)}
        />
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
      <ConfirmDialog
        open={deleteFolderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteFolderTarget(null);
        }}
        kind="destructive"
        title={`Delete folder “${deleteFolderTarget?.name}”?`}
        description="Artifacts inside are kept and become ungrouped."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteFolderTarget)
            deleteFolder.mutate({ id: deleteFolderTarget.id });
          setDeleteFolderTarget(null);
        }}
      />
    </div>
  );
}
