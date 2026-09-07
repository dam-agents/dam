import type { ArtifactKind, LibraryArtifact } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

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
    return <Badge variant={variant}>{label}</Badge>;
  }
  return (
    <Tooltip content={isPublic ? "Change sharing" : "Share this artifact"}>
      <Badge
        asChild
        variant={variant}
        className="cursor-pointer hover:border-current"
      >
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => onShare(artifact)}
        >
          {label}
        </button>
      </Badge>
    </Tooltip>
  );
}
