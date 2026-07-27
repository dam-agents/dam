import type { ArtifactKind, LibraryArtifact } from "api-server-api";
import { Globe } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { expiryState } from "../lib/format.js";

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

/** One badge summarizing reach: Expired > Password > Public > Private. */
export function ArtifactStatusBadge({
  artifact,
}: {
  artifact: LibraryArtifact;
}) {
  if (expiryState(artifact.expiresAt).state === "expired") {
    return <Badge variant="danger">Expired</Badge>;
  }
  if (artifact.visibility !== "public") {
    return <Badge variant="muted">Private</Badge>;
  }
  return (
    <Badge variant="success" className="gap-1">
      <Globe size={12} />
      Public
    </Badge>
  );
}
