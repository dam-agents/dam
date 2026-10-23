import { OverflowMenuVertical } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { type CSSProperties, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useArtifacts } from "../api/queries.js";
import { ArtifactKindBadge } from "./artifact-badges.js";
import { ArtifactRowMenuItems } from "./artifact-row-menu-items.js";
import { MoveArtifactDialog } from "./move-artifact-dialog.js";
import { RenameArtifactDialog } from "./rename-artifact-dialog.js";
import { RetentionDialog } from "./retention-dialog.js";
import { ShareDialog } from "./share-dialog.js";
import { VersionBadge } from "./version-badge.js";

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
  const { data: artifacts = [], isPending } = useArtifacts(
    open && agentId ? { agentId } : null,
  );
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
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
      {artifacts.length === 0 ? (
        <p className="px-4 py-5 text-xs text-muted-foreground">
          {isPending ? "Loading\u2026" : "No artifacts yet"}
        </p>
      ) : (
        <div className="overflow-y-auto">
          {artifacts.map((artifact) => (
            <ArtifactListRow
              key={artifact.id}
              artifact={artifact}
              active={artifact.id === openArtifactId}
              onClick={() =>
                setOpenArtifactId(
                  artifact.id === openArtifactId ? null : artifact.id,
                )
              }
              onRename={setRenameTarget}
              onMove={setMoveTarget}
              onShare={setShareTarget}
              onSetRetention={setRetentionTarget}
            />
          ))}
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
  onRename,
  onMove,
  onShare,
  onSetRetention,
}: {
  artifact: LibraryArtifact;
  active: boolean;
  onClick: () => void;
  onRename: (artifact: LibraryArtifact) => void;
  onMove: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onSetRetention: (artifact: LibraryArtifact) => void;
}) {
  return (
    <div
      {...clickableProps(onClick)}
      title={artifact.title}
      className={cn(
        "group flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted",
        active && "bg-muted text-foreground",
      )}
    >
      <ArtifactKindBadge kind={artifact.kind} />
      <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
      {artifact.version > 1 && <VersionBadge version={artifact.version} />}
      {artifact.visibility === "public" && (
        <span
          role="img"
          aria-label="Shared"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
        />
      )}
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
