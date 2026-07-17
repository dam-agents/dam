import type { LibraryArtifact } from "api-server-api";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { SidebarSection } from "../../sessions/components/sidebar-section.js";
import { useArtifacts } from "../api/queries.js";
import { ArtifactKindBadge } from "./artifact-badges.js";

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

  return (
    <SidebarSection
      title="Artifacts"
      open={open}
      onToggle={onToggle}
      className={className}
      style={style}
    >
      {artifacts.length === 0 ? (
        <p className="px-4 py-5 text-[12px] text-text-muted">
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
            />
          ))}
        </div>
      )}
    </SidebarSection>
  );
}

function ArtifactListRow({
  artifact,
  active,
  onClick,
}: {
  artifact: LibraryArtifact;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={artifact.title}
      className={cn(
        "flex h-[32px] w-full items-center gap-2 px-3 text-left text-[13px] text-text-secondary transition-colors hover:bg-muted",
        active && "bg-muted text-foreground",
      )}
    >
      <ArtifactKindBadge kind={artifact.kind} />
      <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
      {artifact.version > 1 && (
        <span
          className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground"
          title={`Version ${artifact.version}`}
        >
          v{artifact.version}
        </span>
      )}
      {artifact.visibility === "public" && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
          title="Shared"
        />
      )}
    </button>
  );
}
