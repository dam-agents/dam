import {
  Box,
  Edit,
  FolderAdd,
  Link,
  OverflowMenuVertical,
  TrashCan,
  Upload,
  View,
} from "@carbon/icons-react";
import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import {
  type CSSProperties,
  type Ref,
  useCallback,
  useMemo,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Input } from "@/components/ui/input";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/hooks/use-copy";
import { clickableProps } from "@/lib/clickable";
import { formatBytes } from "@/lib/format-size";
import { cn } from "@/lib/utils";

import { api } from "../../../api.js";
import { useStore } from "../../../store.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useDeleteFolder } from "../api/mutations.js";
import { useArtifactFolders, useArtifacts } from "../api/queries.js";
import {
  type ArtifactDragCallbacks,
  useArtifactRowDrag,
  useFolderDropTarget,
} from "../hooks/use-artifact-row-drag.js";
import { useFolderDragOrchestration } from "../hooks/use-folder-drag-orchestration.js";
import { useOpenArtifact } from "../hooks/use-open-artifact.js";
import { folderDisplayNames } from "../lib/folders.js";
import { groupArtifactsByFolder } from "../lib/group-artifacts.js";
import { toastCopyOutcome } from "../lib/share-link.js";
import {
  ArtifactDeletionChip,
  ArtifactInteractiveBadge,
  ArtifactVisibilityButton,
} from "./artifact-badges.js";
import { ArtifactRowMenuItems } from "./artifact-row-menu-items.js";
import { FolderDialog } from "./folder-dialog.js";
import { MoveArtifactDialog } from "./move-artifact-dialog.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { RetentionDialog } from "./retention-dialog.js";
import { ShareDialog } from "./share-dialog.js";
import { SidebarFolderGroup } from "./sidebar-folder-group.js";
import { UploadArtifactDialog } from "./upload-artifact-dialog.js";

const ALL_SCOPE = "__all__";

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
  const scopeAgentId = scope === "agent" ? agentId : null;
  const { data: artifacts = [], isPending } = useArtifacts(
    open ? (scopeAgentId ? { agentId: scopeAgentId } : {}) : null,
  );
  const { data: folders = [], isPending: foldersPending } =
    useArtifactFolders(open);
  const loading = open && (isPending || foldersPending);
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
  const openArtifactId = useStore((s) => s.openArtifactId);
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
  const [editFolder, setEditFolder] = useState<ArtifactFolder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<ArtifactFolder | null>(null);
  const deleteFolder = useDeleteFolder();

  const renderRow = (artifact: LibraryArtifact) => (
    <ArtifactListRow
      key={artifact.id}
      artifact={artifact}
      active={artifact.id === openArtifactId}
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
      {loading || shown.length === 0 ? (
        <p className="px-4 py-5 text-xs text-muted-foreground">
          {loading
            ? "Loading…"
            : term
              ? "No matching artifacts."
              : "No artifacts yet."}
        </p>
      ) : (
        <div
          {...rootDrop}
          className={cn(
            "overflow-y-auto",
            dragInProgress &&
              hotFolderId === null &&
              "ring-2 ring-inset ring-primary",
          )}
        >
          {groups.map((group) => {
            if (!group.folder) return group.artifacts.map(renderRow);
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
                {group.artifacts.map(renderRow)}
              </SidebarFolderGroup>
            );
          })}
        </div>
      )}
      {!loading && shown.length > 0 && (
        <p className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
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
    </SidebarSection>
  );
}

function ArtifactListRow({
  artifact,
  active,
  onClick,
  drag,
  showCreator,
  onEdit,
  onRename,
  onMove,
  onShare,
  onSetRetention,
}: {
  artifact: LibraryArtifact;
  active: boolean;
  onClick: () => void;
  drag?: ArtifactDragCallbacks;
  showCreator: boolean;
  onEdit: (artifact: LibraryArtifact) => void;
  onRename: (artifact: LibraryArtifact) => void;
  onMove: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onSetRetention: (artifact: LibraryArtifact) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startDrag = useCallback(
    (folderId: string | null) => {
      setDragging(true);
      drag?.onStart(folderId);
    },
    [drag],
  );
  const endDrag = useCallback(() => {
    setDragging(false);
    drag?.onEnd();
  }, [drag]);
  const dragProps = useArtifactRowDrag(artifact.id, artifact.folderId, {
    onStart: startDrag,
    onEnd: endDrag,
  });

  const menuActions = { onEdit, onRename, onMove, onShare, onSetRetention };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...clickableProps(onClick)}
          {...(drag ? dragProps : {})}
          title={artifact.title}
          className={cn(
            "group flex min-h-8 w-full cursor-pointer items-center gap-1.5 py-1 pl-3.5 pr-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted",
            active && "bg-muted text-foreground",
            dragging && "opacity-50",
          )}
        >
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <ArtifactVisibilityButton
              artifact={artifact}
              onShare={() => onShare(artifact)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate">{artifact.title}</span>
            {(showCreator ||
              artifact.expiresAt !== null ||
              artifact.viewCount > 0 ||
              artifact.interactive) && (
              <span className="flex min-w-0 items-center gap-2 overflow-hidden text-xs">
                {showCreator && <CreatorChip agentId={artifact.agentId} />}
                <ArtifactDeletionChip expiresAt={artifact.expiresAt} />
                {artifact.viewCount > 0 && (
                  <Tooltip
                    content={`${artifact.viewCount} view${artifact.viewCount === 1 ? "" : "s"} of its share link`}
                  >
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <View size={12} />
                      {artifact.viewCount}
                    </span>
                  </Tooltip>
                )}
                {artifact.interactive && <ArtifactInteractiveBadge />}
              </span>
            )}
          </div>
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              {}
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={HOVER_ACTION}
                  aria-label="More actions"
                >
                  <OverflowMenuVertical size={13} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <ArtifactRowMenuItems artifact={artifact} {...menuActions} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ArtifactRowMenuItems
          artifact={artifact}
          {...menuActions}
          menu="context"
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FolderActionsMenu({
  folder,
  shared,
  onEdit,
  onDelete,
}: {
  folder: ArtifactFolder;
  shared: boolean;
  onEdit: (folder: ArtifactFolder) => void;
  onDelete: (folder: ArtifactFolder) => void;
}) {
  const { copy } = useCopy();
  return (
    <RowActionsMenu label="Folder actions" dense>
      <DropdownMenuItem
        disabled={!shared}
        onSelect={() =>
          void copy(() =>
            api.artifactLibrary.folderShareUrl.query({ id: folder.id }),
          ).then(toastCopyOutcome)
        }
      >
        <Link size={14} />
        Copy folder link
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onEdit(folder)}>
        <Edit size={14} />
        Edit folder
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem tone="danger" onSelect={() => onDelete(folder)}>
        <TrashCan size={14} />
        Delete folder
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}

function CreatorChip({ agentId }: { agentId: string | null }) {
  if (!agentId)
    return (
      <Badge variant="muted" className="shrink-0">
        you
      </Badge>
    );
  return <AgentCreatorChip agentId={agentId} />;
}

function AgentCreatorChip({ agentId }: { agentId: string }) {
  const selectAgent = useStore((s) => s.selectAgent);
  const agentName = useAgentDisplayName(agentId);
  return (
    <Tooltip content={`Open ${agentName}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          selectAgent(agentId);
        }}
        className="inline-flex max-w-24 shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-px text-xs transition-colors hover:bg-accent-light hover:text-accent"
      >
        <Box size={12} className="shrink-0" />
        <span className="truncate">{agentName}</span>
      </button>
    </Tooltip>
  );
}
