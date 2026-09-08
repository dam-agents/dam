import {
  ArrowsVertical,
  Link,
  OverflowMenuVertical,
} from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { type CSSProperties, useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Tooltip } from "@/components/ui/tooltip";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useArtifactFolders, useArtifacts } from "../api/queries.js";
import {
  type ArtifactDragCallbacks,
  useArtifactRowDrag,
} from "../hooks/use-artifact-row-drag.js";
import { useFolderDragOrchestration } from "../hooks/use-folder-drag-orchestration.js";
import { folderDisplayNames } from "../lib/folders.js";
import { groupArtifactsByFolder } from "../lib/group-artifacts.js";
import { ArtifactRowMenuItems } from "./artifact-row-menu-items.js";
import { MarqueeTitle } from "./marquee-title.js";
import { MoveArtifactDialog } from "./move-artifact-dialog.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { RetentionDialog } from "./retention-dialog.js";
import { ShareDialog } from "./share-dialog.js";
import { SidebarFolderGroup } from "./sidebar-folder-group.js";

export function ChatArtifactsPanel({
  agentId,
  open,
  onToggle,
  className,
  style,
}: {
  agentId: string | null;
  open: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const enabled = open && !!agentId;
  const { data: artifacts = [], isPending } = useArtifacts(
    enabled && agentId ? { agentId } : null,
  );
  const { data: folders = [], isPending: foldersPending } =
    useArtifactFolders(enabled);
  const loading = enabled && (isPending || foldersPending);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const folderCollapse = useStore((s) =>
    agentId ? s.artifactFolderCollapse[agentId] : undefined,
  );
  const setFolderCollapsed = useStore((s) => s.setArtifactFolderCollapsed);
  const { dropCallbacks, hotFolderId, dragInProgress } =
    useFolderDragOrchestration(artifacts);
  const groups = useMemo(
    () =>
      groupArtifactsByFolder(artifacts, folders, {
        includeEmptyUngrouped: dragInProgress,
      }),
    [artifacts, folders, dragInProgress],
  );
  const folderNames = useMemo(() => folderDisplayNames(folders), [folders]);
  const [renameTarget, setRenameTarget] = useState<LibraryArtifact | null>(
    null,
  );
  const [moveTarget, setMoveTarget] = useState<LibraryArtifact | null>(null);
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);
  const [retentionTarget, setRetentionTarget] =
    useState<LibraryArtifact | null>(null);

  return (
    <SidebarSection
      title="Artifacts"
      open={open}
      onToggle={onToggle}
      className={className}
      headerClassName="border-t border-border"
      style={style}
    >
      {loading || artifacts.length === 0 ? (
        <p className="px-4 py-5 text-xs text-muted-foreground">
          {loading ? "Loading\u2026" : "No artifacts yet"}
        </p>
      ) : (
        <div className="overflow-y-auto">
          {groups.map((group) => {
            const collapsed =
              folderCollapse?.[group.key] ?? group.artifacts.length === 0;
            return (
              <SidebarFolderGroup
                key={group.key}
                folderId={group.folder?.id ?? null}
                label={
                  group.folder
                    ? (folderNames.get(group.folder.id) ?? group.folder.name)
                    : "Ungrouped"
                }
                count={group.artifacts.length}
                collapsed={collapsed}
                onToggle={() => {
                  if (agentId)
                    setFolderCollapsed(agentId, group.key, !collapsed);
                }}
                drop={dropCallbacks}
                dropActive={hotFolderId === (group.folder?.id ?? null)}
                testId={`artifacts-folder-${group.key}`}
              >
                {group.artifacts.map((artifact) => (
                  <ArtifactListRow
                    key={artifact.id}
                    artifact={artifact}
                    active={artifact.id === openArtifactId}
                    onClick={() =>
                      setOpenArtifactId(
                        artifact.id === openArtifactId ? null : artifact.id,
                      )
                    }
                    drag={dropCallbacks}
                    onEdit={(a) => setOpenArtifactId(a.id, { edit: true })}
                    onRename={setRenameTarget}
                    onMove={setMoveTarget}
                    onShare={setShareTarget}
                    onSetRetention={setRetentionTarget}
                  />
                ))}
              </SidebarFolderGroup>
            );
          })}
        </div>
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
    </SidebarSection>
  );
}

function ArtifactListRow({
  artifact,
  active,
  onClick,
  drag,
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
  onEdit: (artifact: LibraryArtifact) => void;
  onRename: (artifact: LibraryArtifact) => void;
  onMove: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onSetRetention: (artifact: LibraryArtifact) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
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

  return (
    <div
      {...clickableProps(onClick)}
      {...(drag ? dragProps : {})}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={artifact.title}
      className={cn(
        "group flex h-8 w-full cursor-pointer items-center gap-1.5 py-1 pl-3.5 pr-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted",
        active && "bg-muted text-foreground",
        dragging && "opacity-50",
      )}
    >
      <ArrowsVertical
        size={12}
        aria-hidden
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
      <MarqueeTitle
        text={artifact.title}
        animate={active || hovered}
        className="min-w-0 flex-1"
      />
      {artifact.shareUrl !== null && (
        <Tooltip
          content={
            artifact.visibility === "restricted" ? "Restricted" : "Public"
          }
        >
          <span
            role="img"
            aria-label={
              artifact.visibility === "restricted" ? "Restricted" : "Public"
            }
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
          />
        </Tooltip>
      )}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon-xs"
          className={HOVER_ACTION}
          aria-label="Share"
          tooltip="Share"
          onClick={() => onShare(artifact)}
        >
          <Link size={16} />
        </Button>
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
            <ArtifactRowMenuItems
              artifact={artifact}
              onEdit={onEdit}
              onRename={onRename}
              onMove={onMove}
              onShare={onShare}
              onSetRetention={onSetRetention}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
