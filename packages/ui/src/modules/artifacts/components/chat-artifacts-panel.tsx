import { FolderAdd, Upload } from "@carbon/icons-react";
import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import {
  type CSSProperties,
  type Ref,
  useEffect,
  useMemo,
  useState,
} from "react";
import { match } from "ts-pattern";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { formatBytes } from "@/lib/format-size";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useDeleteFolder } from "../api/mutations.js";
import { useArtifactFolders, useArtifacts } from "../api/queries.js";
import { useFolderDropTarget } from "../hooks/use-artifact-row-drag.js";
import { useFolderDragOrchestration } from "../hooks/use-folder-drag-orchestration.js";
import { useOpenArtifact } from "../hooks/use-open-artifact.js";
import { folderDisplayNames } from "../lib/folders.js";
import { groupArtifactsByFolder } from "../lib/group-artifacts.js";
import { ArtifactListRow } from "./artifact-list-row.js";
import { FolderActionsMenu } from "./folder-actions-menu.js";
import { FolderDialog } from "./folder-dialog.js";
import { MoveArtifactDialog } from "./move-artifact-dialog.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { RetentionDialog } from "./retention-dialog.js";
import { ShareDialog } from "./share-dialog.js";
import { SidebarFolderGroup } from "./sidebar-folder-group.js";
import { UploadArtifactDialog } from "./upload-artifact-dialog.js";

const ALL_SCOPE = "__all__";
const UPLOAD_HIGHLIGHT_MS = 3000;

type ArtifactScope = "agent" | "all";

const SCOPE_TABS = [
  { value: "agent", label: "This agent" },
  { value: "all", label: "All" },
] as const;

export function ChatArtifactsPanel({
  agentId,
  open,
  onToggle,
  className,
  style,
  ref,
}: {
  agentId: string | null;
  open: boolean;
  onToggle?: () => void;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
}) {
  const [scope, setScope] = useState<ArtifactScope>("agent");
  const scopeAgentId = match(scope)
    .with("agent", () => agentId)
    .with("all", () => null)
    .exhaustive();
  const artifactsQuery = useArtifacts(
    open ? (scopeAgentId ? { agentId: scopeAgentId } : {}) : null,
  );
  const foldersQuery = useArtifactFolders(open);
  const { data: artifacts = [] } = artifactsQuery;
  const { data: folders = [] } = foldersQuery;
  const failed = artifactsQuery.isError || foldersQuery.isError;
  const loading =
    open && !failed && (artifactsQuery.isPending || foldersQuery.isPending);
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      term
        ? artifacts.filter(
            (a) =>
              a.title.toLowerCase().includes(term) ||
              a.fileName.toLowerCase().includes(term),
          )
        : artifacts,
    [artifacts, term],
  );
  const shownBytes = shown.reduce((sum, a) => sum + a.sizeBytes, 0);
  const openArtifactId = useStore((s) =>
    s.dock?.kind === "artifact" ? s.dock.id : null,
  );
  const openArtifact = useOpenArtifact();

  const openRow = (id: string) =>
    openArtifact(id === openArtifactId ? null : id);
  const collapseScope = scopeAgentId ?? ALL_SCOPE;
  const folderCollapse = useStore(
    (s) => s.artifactFolderCollapse[collapseScope],
  );
  const setFolderCollapsed = useStore((s) => s.setArtifactFolderCollapsed);
  const { dropCallbacks, hotFolderId, dragInProgress } =
    useFolderDragOrchestration(artifacts);
  const groups = useMemo(() => {
    const all = groupArtifactsByFolder(shown, folders);
    return term ? all.filter((g) => g.artifacts.length > 0) : all;
  }, [shown, folders, term]);
  const rootDrop = useFolderDropTarget(null, dropCallbacks);
  const folderNames = useMemo(() => folderDisplayNames(folders), [folders]);
  const [renameTarget, setRenameTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [moveTarget, setMoveTarget] = useState<LibraryArtifact | null>(null);
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);
  const [retentionTarget, setRetentionTarget] =
    useState<LibraryArtifact | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), UPLOAD_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);
  const [editFolder, setEditFolder] = useState<ArtifactFolder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<ArtifactFolder | null>(null);
  const deleteFolder = useDeleteFolder();

  const renderRow = (artifact: LibraryArtifact, depth: number) => (
    <ArtifactListRow
      key={artifact.id}
      artifact={artifact}
      depth={depth}
      active={artifact.id === openArtifactId}
      highlighted={artifact.id === highlightId}
      onClick={() => void openRow(artifact.id)}
      drag={dropCallbacks}
      showCreator={scopeAgentId === null}
      onEdit={(a) => void openArtifact(a.id, { edit: true })}
      onRename={setRenameTarget}
      onMove={setMoveTarget}
      onShare={setShareTarget}
      onSetRetention={setRetentionTarget}
    />
  );

  return (
    <SidebarSection
      title="Artifacts"
      open={open}
      onToggle={onToggle}
      className={className}
      headerClassName="border-t border-border"
      style={style}
      ref={ref}
      headerRight={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Upload artifact"
            tooltip="Upload artifact"
            onClick={() => setUploading(true)}
          >
            <Upload size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New folder"
            tooltip="New folder"
            onClick={() => setCreatingFolder(true)}
          >
            <FolderAdd size={16} />
          </Button>
        </>
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        {agentId && (
          <Tabs
            tabs={SCOPE_TABS}
            value={scope}
            onValueChange={setScope}
            variant="pill"
            size="sm"
            ariaLabel="Artifacts to list"
            className="shrink-0"
          />
        )}
        <Input
          type="search"
          size="sm"
          placeholder="Search artifacts…"
          aria-label="Search artifacts"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1"
        />
      </div>
      {failed ? (
        <EmptyState
          bordered={false}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void artifactsQuery.refetch();
                void foldersQuery.refetch();
              }}
            >
              Retry
            </Button>
          }
        >
          Couldn't load artifacts.
        </EmptyState>
      ) : loading || groups.length === 0 ? (
        <EmptyState bordered={false}>
          {loading
            ? "Loading…"
            : term
              ? "No matching artifacts."
              : "No artifacts yet."}
        </EmptyState>
      ) : (
        <div
          {...rootDrop}
          className={cn(
            "flex-1 overflow-y-auto",
            dragInProgress &&
              hotFolderId === null &&
              "ring-2 ring-inset ring-primary",
          )}
        >
          {groups.map((group) => {
            if (!group.folder)
              return group.artifacts.map((a) => renderRow(a, 0));
            const collapsed =
              folderCollapse?.[group.key] ?? group.artifacts.length === 0;
            return (
              <SidebarFolderGroup
                key={group.key}
                folderId={group.folder.id}
                label={folderNames.get(group.folder.id) ?? group.folder.name}
                count={group.artifacts.length}
                collapsed={collapsed}
                onToggle={() =>
                  setFolderCollapsed(collapseScope, group.key, !collapsed)
                }
                drop={dropCallbacks}
                dropActive={hotFolderId === group.folder.id}
                testId={`artifacts-folder-${group.key}`}
                actions={
                  <FolderActionsMenu
                    folder={group.folder}
                    shared={group.artifacts.some(
                      (a) => a.visibility === "public",
                    )}
                    onEdit={setEditFolder}
                    onDelete={setDeleteFolderTarget}
                  />
                }
              >
                {group.artifacts.map((a) => renderRow(a, 1))}
              </SidebarFolderGroup>
            );
          })}
        </div>
      )}
      {!loading && !failed && artifacts.length > 0 && (
        <p className="mt-auto shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {shown.length} artifact{shown.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(shownBytes)} stored
        </p>
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
      {creatingFolder && (
        <FolderDialog folder={null} onClose={() => setCreatingFolder(false)} />
      )}
      {editFolder && (
        <FolderDialog folder={editFolder} onClose={() => setEditFolder(null)} />
      )}
      {uploading && (
        <UploadArtifactDialog
          folders={folders}
          onClose={() => setUploading(false)}
          onUploaded={(artifact) => {
            if (artifact.agentId !== scopeAgentId) setScope("all");
            setSearch("");
            if (artifact.folderId)
              setFolderCollapsed(
                artifact.agentId === scopeAgentId ? collapseScope : ALL_SCOPE,
                artifact.folderId,
                false,
              );
            setHighlightId(artifact.id);
          }}
        />
      )}
      <ConfirmDialog
        open={deleteFolderTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteFolderTarget(null);
        }}
        kind="destructive"
        title={`Delete folder “${deleteFolderTarget?.name ?? ""}”?`}
        description="Artifacts inside are kept and move to the top level."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteFolderTarget)
            deleteFolder.mutate({ id: deleteFolderTarget.id });
          setDeleteFolderTarget(null);
        }}
      />
    </SidebarSection>
  );
}
