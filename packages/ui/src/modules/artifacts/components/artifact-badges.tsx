import { Globe, UserMultiple } from "@carbon/icons-react";
import type { ArtifactKind, LibraryArtifact } from "api-server-api";
import { match } from "ts-pattern";

import { Badge } from "@/components/ui/badge";

import { deletionState } from "../lib/format.js";

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
}: {
  artifact: LibraryArtifact;
}) {
  const expiring = deletionState(artifact.expiresAt).state === "expired";
  return match({ expiring, visibility: artifact.visibility })
    .with({ expiring: true }, () => (
      <Badge variant="danger">Deleting soon</Badge>
    ))
    .with({ visibility: "private" }, () => (
      <Badge variant="muted">Private</Badge>
    ))
    .with({ visibility: "restricted" }, () => (
      <Badge variant="info" className="gap-1">
        <UserMultiple size={12} />
        Restricted
      </Badge>
    ))
    .with({ visibility: "public" }, () => (
      <Badge variant="success" className="gap-1">
        <Globe size={12} />
        Public
      </Badge>
    ))
    .exhaustive();
}
