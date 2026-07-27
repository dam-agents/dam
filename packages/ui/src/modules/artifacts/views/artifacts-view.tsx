import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import { EXPERIMENT_FOLDER_PREFIX } from "api-server-api";
import { FolderPlus, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";

import { api } from "../../../api.js";
import { useDeleteArtifact, useDeleteFolder } from "../api/mutations.js";
import { useArtifactFolders, useArtifacts } from "../api/queries.js";
import { ArtifactPreviewDialog } from "../components/artifact-preview-dialog.js";
import { ExperimentsSection } from "../components/experiments-section.js";
import { FolderDialog } from "../components/folder-dialog.js";
import { FolderGroup } from "../components/folder-group.js";
import { ShareDialog } from "../components/share-dialog.js";
import { UploadArtifactDialog } from "../components/upload-artifact-dialog.js";
import { formatBytes } from "../lib/format.js";

const EMPTY_ARTIFACTS: LibraryArtifact[] = [];
const EMPTY_FOLDERS: ArtifactFolder[] = [];

export function ArtifactsView() {
  const { data: artifacts = EMPTY_ARTIFACTS, isLoading } = useArtifacts();
  const { data: folders = EMPTY_FOLDERS } = useArtifactFolders();

  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState<{
    folder: ArtifactFolder | null;
  } | null>(null);
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<ArtifactFolder | null>(null);

  const deleteArtifact = useDeleteArtifact();
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
    onShare: setShareTarget,
    onDelete: setDeleteTarget,
  };

  const copyFolderLink = async (folder: ArtifactFolder) => {
    // Imperative one-shot read — the URL only exists while something inside
    // the folder is shared, so it's resolved at click time, not subscribed.
    return api.artifactLibrary.folderShareUrl
      .query({ id: folder.id })
      .then((url) => url ?? null);
  };

  // Platform-managed experiment lineage folders render apart from the user's
  // own folders — one muted, collapsed section at the bottom.
  const experimentFolders = folders.filter((f) =>
    f.name.startsWith(EXPERIMENT_FOLDER_PREFIX),
  );
  const userFolders = folders.filter(
    (f) => !f.name.startsWith(EXPERIMENT_FOLDER_PREFIX),
  );

  const ungrouped = byFolder.get(null) ?? [];
  const isEmpty = !isLoading && artifacts.length === 0 && folders.length === 0;

  return (
    <div className="anim-in">
      <PageHeader
        title="Artifacts"
        description="Pages and files created by you and your agents. Share with a link, set an expiry."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFolderDialog({ folder: null })}
            >
              <FolderPlus size={16} />
              New folder
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload size={16} />
              Upload artifact
            </Button>
          </>
        }
      />

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

      <div className="mt-5 flex flex-col gap-3">
        {isEmpty ? (
          <EmptyState onUpload={() => setUploadOpen(true)} />
        ) : (
          <>
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
              <FolderGroup
                folder={null}
                artifacts={ungrouped}
                {...rowActions}
              />
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
          </>
        )}
      </div>

      {artifacts.length > 0 && (
        <p className="mt-5 text-[13px] text-muted-foreground">
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

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 border border-border px-6 py-12 text-center anim-in">
      <h2 className="text-[16px] font-semibold text-foreground">
        No artifacts yet
      </h2>
      <p className="max-w-[400px] text-[14px] text-muted-foreground">
        Agents publish artifacts with their built-in tools, or upload one
        yourself — then share it with a link.
      </p>
      <Button size="sm" onClick={onUpload}>
        <Upload size={16} />
        Upload artifact
      </Button>
    </Card>
  );
}
