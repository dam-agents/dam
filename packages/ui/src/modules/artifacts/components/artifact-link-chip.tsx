import { ARTIFACT_INTERNAL_LINK_PREFIX } from "api-server-api";
import { Box } from "lucide-react";
import type { ReactNode } from "react";

import { useStore } from "../../../store.js";
import { useArtifact } from "../api/queries.js";
import { ArtifactKindBadge } from "./artifact-badges.js";

export const ARTIFACT_LINK_PREFIX = ARTIFACT_INTERNAL_LINK_PREFIX;

/** The id when `href` is an internal artifact link, else null. */
export function parseArtifactLink(href: string | undefined): string | null {
  if (!href?.startsWith(ARTIFACT_LINK_PREFIX)) return null;
  const id = href.slice(ARTIFACT_LINK_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/** Inline chip rendered wherever markdown carries a `platform://artifacts/…`
 *  link (agents get the link back from the MCP tools and paste it into chat).
 *  Clicking opens the docked live preview beside the chat. */
export function ArtifactLinkChip({
  artifactId,
  children,
}: {
  artifactId: string;
  children?: ReactNode;
}) {
  const { data: artifact } = useArtifact(artifactId);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);

  const label =
    artifact?.title ??
    (typeof children === "string" && children !== artifactId
      ? children
      : "artifact");

  return (
    <button
      type="button"
      onClick={() =>
        setOpenArtifactId(artifactId === openArtifactId ? null : artifactId)
      }
      title={artifact ? `Preview “${artifact.title}”` : "Preview artifact"}
      className="not-prose inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 align-middle text-[13px] font-medium text-foreground transition-colors hover:border-accent hover:bg-accent-light hover:text-accent"
    >
      {artifact ? (
        <ArtifactKindBadge kind={artifact.kind} />
      ) : (
        <Box size={13} className="shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
