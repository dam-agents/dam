import {
  Launch,
  OverflowMenuHorizontal,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { repoSlug } from "@/lib/git-source";
import { cn } from "@/lib/utils";

function SourceListRow({
  source,
  visibility,
  scannedAt,
  divided,
  onRescan,
  onRemove,
}: {
  source: SkillSource;
  visibility?: "public" | "private";
  scannedAt?: string;
  divided: boolean;
  onRescan: () => void;
  onRemove: () => void;
}) {
  const canRemove = !source.system && !source.fromTemplate;
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5",
        divided && "border-t border-border",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[15px] font-medium text-foreground">
            {source.name}
          </p>
          {visibility === "private" && (
            <Badge variant="template" className="shrink-0">
              Private
            </Badge>
          )}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {repoSlug(source.gitUrl)}
          {source.path ? ` · ${source.path}` : ""}
        </p>
      </div>
      {scannedAt && (
        <span
          className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground"
          title={formatTimestamp(scannedAt)}
        >
          <Time size={13} />
          scanned {timeAgo(scannedAt)}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Source actions"
            className="shrink-0 text-muted-foreground"
          >
            <OverflowMenuHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onRescan}>Re-scan</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              window.open(source.gitUrl, "_blank", "noopener,noreferrer")
            }
          >
            <span className="flex-1">View repo</span>
            <Launch size={14} />
          </DropdownMenuItem>
          {canRemove && (
            <DropdownMenuItem tone="danger" onSelect={onRemove}>
              <TrashCan size={14} />
              <span className="flex-1">Remove source</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SkillSourceList({
  sources,
  visibilityBySource,
  scannedAtBySource,
  onRescan,
  onRemove,
}: {
  sources: SkillSource[];
  visibilityBySource: Record<string, "public" | "private">;
  scannedAtBySource: Record<string, string>;
  onRescan: (source: SkillSource) => void;
  onRemove: (source: SkillSource) => void;
}) {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No skill sources connected.
      </p>
    );
  }
  return (
    <Card>
      {sources.map((source, i) => (
        <SourceListRow
          key={source.id}
          source={source}
          visibility={visibilityBySource[source.id]}
          scannedAt={scannedAtBySource[source.id]}
          divided={i > 0}
          onRescan={() => onRescan(source)}
          onRemove={() => onRemove(source)}
        />
      ))}
    </Card>
  );
}
