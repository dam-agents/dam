import { Calendar } from "@carbon/icons-react";
import type { ArtifactKind, LibraryArtifact } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { HintTooltip, Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { deletionState, deletionTooltip } from "../lib/format.js";

const KIND_PRESENTATION: Record<
  ArtifactKind,
  { label: string; variant: "accent" | "info" | "success" | "muted" }
> = {
  html: { label: "HTML", variant: "accent" },
  jsx: { label: "JSX", variant: "accent" },
  markdown: { label: "MD", variant: "info" },
  code: { label: "CODE", variant: "success" },
  text: { label: "TXT", variant: "muted" },
  binary: { label: "FILE", variant: "muted" },
};

export function ArtifactKindBadge({ kind }: { kind: ArtifactKind }) {
  const { label, variant } = KIND_PRESENTATION[kind];
  return (
    <Badge
      size="sm"
      variant={variant}
      className="min-w-[46px] justify-center tracking-wider"
    >
      {label}
    </Badge>
  );
}

export function ArtifactStatusBadge({
  artifact,
  onShare,
}: {
  artifact: LibraryArtifact;
  onShare?: (artifact: LibraryArtifact) => void;
}) {
  const isPublic = artifact.visibility === "public";
  const variant = isPublic ? "success" : "muted";
  const label = isPublic ? "Public" : "Private";

  if (!onShare) {
    return (
      <Badge variant={variant} className="font-sans">
        {label}
      </Badge>
    );
  }
  return (
    <Tooltip content={isPublic ? "Change sharing" : "Share this artifact"}>
      <Badge
        asChild
        variant={variant}
        className="cursor-pointer font-sans hover:border-current"
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${label} — ${isPublic ? "change sharing" : "share this artifact"}`}
          onClick={() => onShare(artifact)}
        >
          {label}
        </button>
      </Badge>
    </Tooltip>
  );
}

export function ArtifactDeletionChip({
  expiresAt,
  className,
}: {
  expiresAt: string | null;
  className?: string;
}) {
  const deletion = deletionState(expiresAt);
  if (deletion.state === "never") return null;
  const hint = deletionTooltip(expiresAt);
  return (
    <HintTooltip
      label={hint}
      content={hint}
      className={cn(
        "shrink-0 gap-1 whitespace-nowrap",
        deletion.state === "expired" && "text-danger",
        deletion.state === "active" && deletion.soon && "text-warning",
        className,
      )}
    >
      <Calendar size={12} />
      {deletion.label}
    </HintTooltip>
  );
}
