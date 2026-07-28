import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import { EXPERIMENT_FOLDER_PREFIX } from "api-server-api";
import { Box, FolderPlus, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { api } from "../../../api.js";
import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useDeleteFolder } from "../api/mutations.js";
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
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);
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
    onShare: setShareTarget,
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
  const loading = artifactsLoading || foldersLoading;
  const hasContent = artifacts.length > 0 || folders.length > 0;
  // Folders load on their own query — a folders-only library must not flash the
  // empty state (which also strips the search box) before its groups land.
  const isEmpty = !loading && !hasContent;

  return (
    <div className="anim-in">
      <PageHeader
        title="Artifacts"
        description={
          hasContent
            ? "Pages and files created by you and your agents. Share with a link, set an expiry."
            : undefined
        }
        actions={
          hasContent ? (
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

      {/* Artifacts can be warm from another view while folders is still cold —
          skeleton only when there is nothing to show, never above content. */}
      {loading && !hasContent && <ListSkeleton rows={2} rowHeight={70} />}

      {isEmpty && (
        <PageEmptyState
          title="No artifacts yet"
          message="Artifacts from every sandbox collect here."
          actionLabel="Go to sandboxes"
          actionIcon={<Box size={16} />}
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
