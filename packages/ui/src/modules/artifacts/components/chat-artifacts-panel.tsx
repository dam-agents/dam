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
import { ShareDialog } from "./share-dialog.js";
import { VersionBadge } from "./version-badge.js";

/** Tracks agents publishing mid-conversation without a manual refresh. */
const LIVE_POLL_MS = 5000;

/** Chat sidebar section listing the agent's published artifacts — the
 *  artifact counterpart of the Files section. Clicking a row opens the
 *  docked live preview beside the chat. */
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
  const { data: artifacts = [] } = useArtifacts(
    agentId ? { agentId } : null,
    open ? { refetchIntervalMs: LIVE_POLL_MS } : undefined,
  );
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const [shareTarget, setShareTarget] = useState<LibraryArtifact | null>(null);

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
          No artifacts yet
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
              onShare={setShareTarget}
            />
          ))}
        </div>
      )}
      {shareTarget && (
        <ShareDialog
          artifact={shareTarget}
          onClose={() => setShareTarget(null)}
        />
      )}
    </SidebarSection>
  );
}

function ArtifactListRow({
  artifact,
  active,
  onClick,
  onShare,
}: {
  artifact: LibraryArtifact;
  active: boolean;
  onClick: () => void;
  onShare: (artifact: LibraryArtifact) => void;
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
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
          title="Shared"
        />
      )}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          {/* Kept mounted at opacity-0 so hovering doesn't reflow the row. */}
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={HOVER_ACTION}
              aria-label="More actions"
              tooltip="More actions"
            >
              <OverflowMenuVertical size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <ArtifactRowMenuItems artifact={artifact} onShare={onShare} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
