import {
  Checkmark,
  Link,
  Locked,
  OverflowMenuVertical,
  Share,
  Time,
} from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCopy } from "@/hooks/use-copy";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { usePrefetchArtifactPreview } from "../api/queries.js";
import {
  type ArtifactDragCallbacks,
  useArtifactRowDrag,
} from "../hooks/use-artifact-row-drag.js";
import { deletionState } from "../lib/format.js";
import { isRenderedKind } from "../lib/kinds.js";
import { toastCopyOutcome } from "../lib/share-link.js";
import { ArtifactKindBadge } from "./artifact-badges.js";
import { ArtifactRowMenuItems } from "./artifact-row-menu-items.js";

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

  const isPublic = artifact.visibility === "public";

  return (
    <div
      {...clickableProps(() => onPreview(artifact))}
      {...(drag ? dragProps : {})}
      onMouseEnter={warmPreview}
      onFocus={warmPreview}
      className={cn(
        "group/card flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/40",
        deletion.state === "expired" && "opacity-55",
        dragging && "opacity-50",
      )}
      data-testid="artifact-row"
    >
      <ArtifactKindBadge kind={artifact.kind} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">
            {artifact.title}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {artifact.kind.toUpperCase()}
            <span className="mx-0.5">·</span>
            {isPublic ? (
              <>
                <Share size={12} />
                Public
              </>
            ) : (
              <>
                <Locked size={12} />
                Private
              </>
            )}
            {deletion.state !== "never" && (
              <>
                <span className="mx-0.5">·</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 whitespace-nowrap",
                    deletion.state === "expired" && "text-danger",
                    deletion.state === "active" &&
                      deletion.soon &&
                      "text-warning",
                  )}
                >
                  <Time size={12} />
                  {deletion.label}
                </span>
              </>
            )}
          </span>
        </span>
      </span>
      <span
        className="ml-auto flex shrink-0 items-center gap-0.5 text-foreground opacity-0 transition-opacity group-hover/card:opacity-100"
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
      </span>
    </div>
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
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={
        copied
          ? "Share link copied"
          : url
            ? "Copy share link"
            : "Sharing settings"
      }
      tooltip={
        copied ? "Copied!" : url ? "Copy share link" : "Sharing settings…"
      }
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
