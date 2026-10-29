import { Box } from "@carbon/icons-react";
import { ARTIFACT_INTERNAL_LINK_PREFIX } from "api-server-api";

import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { ToolChip } from "../../../types.js";
import { useArtifact } from "../api/queries.js";
import { useOpenArtifact } from "../hooks/use-open-artifact.js";
import { ArtifactKindBadge } from "./artifact-badges.js";

const PREFIX = ARTIFACT_INTERNAL_LINK_PREFIX;

function extractArtifactId(chip: ToolChip): string | null {
  if (!chip.content) return null;
  for (const c of chip.content) {
    if (!c.text) continue;
    const idx = c.text.indexOf(PREFIX);
    if (idx !== -1) {
      const after = c.text.slice(idx + PREFIX.length);
      const id = after.split(/[\s"',)}>\]]/)[0];
      if (id) return id;
    }
  }
  return null;
}

export function isArtifactToolChip(chip: ToolChip): boolean {
  if (
    chip.title.includes("create_artifact") ||
    chip.title.includes("update_artifact")
  )
    return true;
  return extractArtifactId(chip) !== null;
}

export function InlineArtifactCard({ chip }: { chip: ToolChip }) {
  const artifactId = extractArtifactId(chip);
  const { data: artifact } = useArtifact(artifactId);
  const openArtifactId = useStore((s) => s.openArtifactId);
  const openArtifact = useOpenArtifact();

  if (!artifactId) return null;

  const active = artifactId === openArtifactId;

  return (
    <button
      type="button"
      onClick={() => void openArtifact(active ? null : artifactId)}
      className={cn(
        "flex w-full max-w-sm items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        active
          ? "border-accent bg-accent-light text-accent"
          : "border-border bg-card text-foreground hover:border-accent hover:bg-accent-light",
      )}
    >
      {artifact ? (
        <ArtifactKindBadge kind={artifact.kind} />
      ) : (
        <Box size={16} className="shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">
        {artifact?.title ?? "Artifact"}
      </span>
    </button>
  );
}
