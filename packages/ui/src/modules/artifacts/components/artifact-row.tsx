import {
  Box,
  Checkmark,
  Link,
  OverflowMenuVertical,
  Share,
  Time,
  View,
} from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Tooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/hooks/use-copy";
import { clickableProps } from "@/lib/clickable";
import { timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import { usePrefetchArtifactPreview } from "../api/queries.js";
import {
  type ArtifactDragCallbacks,
  useArtifactRowDrag,
} from "../hooks/use-artifact-row-drag.js";
import { deletionState } from "../lib/format.js";
import { isRenderedKind } from "../lib/kinds.js";
import { toastCopyOutcome } from "../lib/share-link.js";
import { ArtifactKindBadge, ArtifactStatusBadge } from "./artifact-badges.js";
import { ArtifactRowMenuItems } from "./artifact-row-menu-items.js";
import { VersionBadge } from "./version-badge.js";

export interface ArtifactRowActions {
  onPreview: (artifact: LibraryArtifact) => void;
  onRename: (artifact: LibraryArtifact) => void;
  onMove: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onSetRetention: (artifact: LibraryArtifact) => void;
}

interface Props extends ArtifactRowActions {
  artifact: LibraryArtifact;
  showAgent?: boolean;
  drag?: ArtifactDragCallbacks;
}

export function ArtifactRow({
  artifact,
  showAgent = true,
  drag,
  onPreview,
  onRename,
  onMove,
  onShare,
  onSetRetention,
}: Props) {
  const deletion = deletionState(artifact.expiresAt);
  const prefetchPreview = usePrefetchArtifactPreview();
  const warmPreview = () => {
    if (isRenderedKind(artifact.kind)) prefetchPreview(artifact.id);
  };
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

  return (
    <div
      {...clickableProps(() => onPreview(artifact))}
      {...(drag ? dragProps : {})}
      onMouseEnter={warmPreview}
      onFocus={warmPreview}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3 border-t border-border px-4 py-2.5 text-left transition-colors hover:bg-muted/60",
        deletion.state === "expired" && "opacity-55",
        dragging && "opacity-50",
      )}
      data-testid="artifact-row"
    >
      <ArtifactKindBadge kind={artifact.kind} />
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
          {artifact.title}
        </span>
        <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
          {showAgent && <CreatorChip agentId={artifact.agentId} />}
          {artifact.version > 1 && <VersionBadge version={artifact.version} />}
          <span className="inline-flex items-center gap-1">
            <View size={12} />
            {artifact.viewCount}
          </span>
          {deletion.state !== "never" && (
            <span
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap",
                deletion.state === "expired" && "text-danger",
                deletion.state === "active" && deletion.soon && "text-warning",
              )}
            >
              <Time size={12} />
              {deletion.label}
            </span>
          )}
          <span className="hidden whitespace-nowrap sm:inline">
            {timeAgo(artifact.createdAt)}
          </span>
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ArtifactStatusBadge artifact={artifact} />
        <div
          draggable={false}
          className={cn("flex gap-0.5", HOVER_ACTION)}
          onClick={(e) => e.stopPropagation()}
        >
          <ShareLinkButton artifact={artifact} onShare={onShare} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <OverflowMenuVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <ArtifactRowMenuItems
                artifact={artifact}
                onRename={onRename}
                onMove={onMove}
                onShare={onShare}
                onSetRetention={onSetRetention}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function CreatorChip({ agentId }: { agentId: string | null }) {
  if (!agentId) {
    return <Badge variant="muted">you</Badge>;
  }
  return <AgentCreatorChip agentId={agentId} />;
}

function AgentCreatorChip({ agentId }: { agentId: string }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const agentName = useAgentDisplayName(agentId);
  return (
    <Tooltip content={`Open ${agentName}'s artifacts`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          navigateToSandboxHome(agentId, "artifacts");
        }}
        className="inline-flex max-w-40 items-center gap-1 rounded-full bg-muted px-2 py-px transition-colors hover:bg-accent-light hover:text-accent"
      >
        <Box size={12} className="shrink-0" />
        <span className="truncate">{agentName}</span>
      </button>
    </Tooltip>
  );
}

function ShareLinkButton({
  artifact,
  onShare,
}: {
  artifact: LibraryArtifact;
  onShare: (artifact: LibraryArtifact) => void;
}) {
  const { copy, copied } = useCopy();
  const url = artifact.shareUrl;
  const copyLabel =
    artifact.visibility === "restricted"
      ? "Copy link — opens only for people on the list"
      : "Copy share link";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={
        copied ? "Share link copied" : url ? copyLabel : "Sharing settings"
      }
      tooltip={copied ? "Copied!" : url ? copyLabel : "Sharing settings…"}
      onClick={() =>
        url ? void copy(url).then(toastCopyOutcome) : onShare(artifact)
      }
    >
      {copied ? (
        <Checkmark size={16} className="text-success" />
      ) : url ? (
        <Link size={16} />
      ) : (
        <Share size={16} />
      )}
    </Button>
  );
}
