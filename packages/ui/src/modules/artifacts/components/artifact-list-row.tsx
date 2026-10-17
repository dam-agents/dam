import { OverflowMenuVertical, View } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Tooltip } from "@/components/ui/tooltip";
import { treeIndent } from "@/components/ui/tree-guide";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import {
  type ArtifactDragCallbacks,
  useArtifactRowDrag,
} from "../hooks/use-artifact-row-drag.js";
import {
  ArtifactDeletionChip,
  ArtifactInteractiveBadge,
  ArtifactVisibilityButton,
} from "./artifact-badges.js";
import { ArtifactRowMenuItems } from "./artifact-row-menu-items.js";

export function ArtifactListRow({
  artifact,
  depth,
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
  depth: number;
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
            "group flex h-8 w-full cursor-pointer items-center gap-1.5 pr-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted",
            active && "bg-muted text-foreground",
            dragging && "opacity-50",
          )}
          style={{ paddingLeft: treeIndent(depth) }}
        >
          <div
            className="-mx-1.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <ArtifactVisibilityButton
              artifact={artifact}
              onShare={() => onShare(artifact)}
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="min-w-12 shrink-[100000] truncate">
              {artifact.title}
            </span>
            {(artifact.expiresAt !== null ||
              artifact.viewCount > 0 ||
              artifact.interactive) && (
              <span className="flex h-4 min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden text-xs text-muted-foreground">
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
          {showCreator && <CreatorByline agentId={artifact.agentId} />}
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

function CreatorByline({ agentId }: { agentId: string | null }) {
  return (
    <span className="flex max-w-28 shrink-0 items-center gap-1 text-xs">
      by
      {agentId ? <AgentCreatorLink agentId={agentId} /> : " you"}
    </span>
  );
}

function AgentCreatorLink({ agentId }: { agentId: string }) {
  const selectAgent = useStore((s) => s.selectAgent);
  const agent = useAgentsList().find((a) => a.id === agentId);
  if (!agent) return <span className="truncate">{agentId}</span>;
  const agentName = agent.name;
  return (
    <Tooltip content={`Open ${agentName}`}>
      <button
        type="button"
        aria-label={`Open ${agentName}`}
        onClick={(e) => {
          e.stopPropagation();
          selectAgent(agentId);
        }}
        className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-accent"
      >
        <AgentAvatar
          name={agentName}
          avatar={agent.avatar}
          size={14}
          className="shrink-0"
        />
        <span className="truncate">{agentName}</span>
      </button>
    </Tooltip>
  );
}
