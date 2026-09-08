import type { ArtifactVersionInfo, LibraryArtifact } from "api-server-api";

import { formatBytes } from "@/lib/format-size";
import { cn } from "@/lib/utils";

import { formatTimestamp, timeAgo } from "../../../lib/format-time.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";

export function VersionList({
  artifact,
  versions,
  current,
  onChange,
}: {
  artifact: LibraryArtifact;
  versions: ArtifactVersionInfo[];
  current: number;
  onChange: (version: number) => void;
}) {
  const agentName = useAgentDisplayName(artifact.agentId);
  const head = versions.reduce((max, v) => Math.max(max, v.version), 0);

  return (
    <ul className="max-h-[50vh] w-[260px] overflow-auto py-1">
      {[...versions].reverse().map((version) => {
        const author =
          version.author === "user"
            ? "You"
            : version.author === "agent"
              ? (agentName ?? "Agent")
              : null;
        return (
          <li key={version.version}>
            <button
              type="button"
              onClick={() => onChange(version.version)}
              aria-current={version.version === current}
              className={cn(
                "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent",
                version.version === current && "bg-accent",
              )}
            >
              <span className="w-8 shrink-0 tabular-nums text-foreground">
                v{version.version}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-muted-foreground"
                title={formatTimestamp(version.createdAt)}
              >
                {timeAgo(version.createdAt)}
                {author ? ` · ${author}` : ""}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatBytes(version.sizeBytes)}
              </span>
              {version.version === head && (
                <span className="shrink-0 text-muted-foreground">latest</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
