import { Document } from "@carbon/icons-react";
import type { MouseEvent } from "react";

import type { ArtifactTouched } from "../api/queries.js";

const SHOWN = 3;

export function FeedArtifactChips({
  artifacts,
  onOpen,
}: {
  artifacts: readonly ArtifactTouched[];
  onOpen: (artifactId: string) => void;
}) {
  if (artifacts.length === 0) return null;
  const shown = artifacts.slice(0, SHOWN);
  const rest = artifacts.length - shown.length;

  const open = (event: MouseEvent, artifactId: string) => {
    event.stopPropagation();
    onOpen(artifactId);
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {shown.map((artifact) => (
        <button
          key={artifact.artifactId}
          type="button"
          onClick={(event) => open(event, artifact.artifactId)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-all hover:border-border hover:bg-muted/70 hover:text-foreground"
        >
          <Document size={16} className="shrink-0" />
          <span className="max-w-[160px] truncate">{artifact.fileName}</span>
        </button>
      ))}
      {rest > 0 && (
        <span className="text-sm text-muted-foreground">+{rest} more</span>
      )}
    </div>
  );
}
