import { Earth, Link, Locked } from "@carbon/icons-react";
import type {
  ArtifactKind,
  ArtifactVisibility,
  LibraryArtifact,
} from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { VISIBILITY_OPTIONS } from "./share-visibility-choice.js";

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

const VISIBILITY_ICON = {
  private: Locked,
  restricted: Link,
  public: Earth,
} satisfies Record<ArtifactVisibility, unknown>;

export function ArtifactVisibilityButton({
  artifact,
  onShare,
}: {
  artifact: LibraryArtifact;
  onShare: () => void;
}) {
  const option = VISIBILITY_OPTIONS.find(
    (o) => o.value === artifact.visibility,
  );
  const label = option
    ? `${option.label} — ${option.description.toLowerCase()}`
    : artifact.visibility;
  const Icon = VISIBILITY_ICON[artifact.visibility];
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-haspopup="dialog"
      aria-label={label}
      tooltip={label}
      onClick={onShare}
    >
      <Icon size={16} />
    </Button>
  );
}
