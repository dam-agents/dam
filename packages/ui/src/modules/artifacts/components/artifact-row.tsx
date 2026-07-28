import type { LibraryArtifact } from "api-server-api";
import {
  Box,
  Clock,
  Download,
  Eye,
  Link as LinkIcon,
  MoreVertical,
  Share2,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import { usePrefetchArtifactPreview } from "../api/queries.js";
import { expiryState, timeAgo } from "../lib/format.js";
import { isRenderedKind } from "../lib/kinds.js";
import { downloadArtifact } from "../lib/transfer.js";
import { ArtifactKindBadge, ArtifactStatusBadge } from "./artifact-badges.js";

export interface ArtifactRowActions {
  onPreview: (artifact: LibraryArtifact) => void;
  onShare: (artifact: LibraryArtifact) => void;
  onDelete: (artifact: LibraryArtifact) => void;
}

interface Props extends ArtifactRowActions {
  artifact: LibraryArtifact;
  /** Hide the creating-agent chip when the context already implies it. */
  showAgent?: boolean;
}

export function ArtifactRow({
  artifact,
  showAgent = true,
  onPreview,
  onShare,
  onDelete,
}: Props) {
  const expiry = expiryState(artifact.expiresAt);
  const prefetchPreview = usePrefetchArtifactPreview();
  const warmPreview = () => {
    if (isRenderedKind(artifact.kind)) prefetchPreview(artifact.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPreview(artifact)}
      onMouseEnter={warmPreview}
      onFocus={warmPreview}
      onKeyDown={(e) => {
        if (e.key === "Enter") onPreview(artifact);
      }}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3 border-t border-border px-4 py-2.5 text-left transition-colors hover:bg-muted/60",
        expiry.state === "expired" && "opacity-55",
      )}
      data-testid="artifact-row"
    >
      <ArtifactKindBadge kind={artifact.kind} />
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-[14px] font-medium text-foreground">
          {artifact.title}
        </span>
        <span className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
          {showAgent && <CreatorChip agentId={artifact.agentId} />}
          {artifact.version > 1 && (
            <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
              v{artifact.version}
            </Badge>
          )}
          <span className="inline-flex items-center gap-1">
            <Eye size={12} />
            {artifact.viewCount}
          </span>
          {expiry.state !== "never" && (
            <span
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap",
                expiry.state === "expired" && "text-danger",
                expiry.state === "active" && expiry.soon && "text-warning",
              )}
            >
              <Clock size={12} />
              {expiry.label}
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
          className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <ShareLinkButton artifact={artifact} onShare={onShare} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="More actions">
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onShare(artifact)}>
                <Share2 size={14} />
                Sharing…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void downloadArtifact(artifact.id)}
              >
                <Download size={14} />
                Download
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                tone="danger"
                onSelect={() => onDelete(artifact)}
              >
                <Trash2 size={14} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function CreatorChip({ agentId }: { agentId: string | null }) {
  if (!agentId) {
    return <span className="rounded-full bg-muted px-2 py-px">you</span>;
  }
  return <AgentCreatorChip agentId={agentId} />;
}

function AgentCreatorChip({ agentId }: { agentId: string }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const agentName = useAgentDisplayName(agentId);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigateToSandboxHome(agentId, "artifacts");
      }}
      title={`Open ${agentName}'s artifacts`}
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px transition-colors hover:bg-accent-light hover:text-accent"
    >
      <Box size={12} />
      {agentName}
    </button>
  );
}

/** Always rendered so the badge column stays aligned across rows: shared
 *  artifacts copy their link, private ones open the sharing dialog. */
function ShareLinkButton({
  artifact,
  onShare,
}: {
  artifact: LibraryArtifact;
  onShare: (artifact: LibraryArtifact) => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = artifact.shareUrl;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={copied ? "Copied!" : url ? "Copy share link" : "Sharing settings…"}
      onClick={() => {
        if (!url) return onShare(artifact);
        void navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <LinkIcon size={16} className={cn(copied && "text-success")} />
    </Button>
  );
}
