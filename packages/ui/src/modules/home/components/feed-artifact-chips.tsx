import { Document } from "@carbon/icons-react";
import type { MouseEvent } from "react";

import { useStore } from "../../../store.js";
import { useArtifact } from "../../artifacts/api/queries.js";

const SHOWN = 3;

function ArtifactChip({ artifactId }: { artifactId: string }) {
  const { data: artifact } = useArtifact(artifactId);
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);

  const open = (event: MouseEvent) => {
    event.stopPropagation();
    setOpenArtifactId(artifactId);
  };

  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-all hover:border-border hover:bg-muted/70 hover:text-foreground"
    >
      <Document size={16} className="shrink-0" />
      <span className="max-w-[160px] truncate">
        {artifact?.fileName ?? artifact?.title ?? "artifact"}
      </span>
    </button>
  );
}

export function FeedArtifactChips({
  artifactIds,
}: {
  artifactIds: readonly string[];
}) {
  if (artifactIds.length === 0) return null;
  const shown = artifactIds.slice(0, SHOWN);
  const rest = artifactIds.length - shown.length;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {shown.map((id) => (
        <ArtifactChip key={id} artifactId={id} />
      ))}
      {rest > 0 && (
        <span className="text-sm text-muted-foreground">+{rest} more</span>
      )}
    </div>
  );
}
