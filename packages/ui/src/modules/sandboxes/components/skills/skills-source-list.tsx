import {
  Launch,
  OverflowMenuHorizontal,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import type { ScanFailure, SkillSource } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { repoSlug } from "@/lib/git-source";
import { cn } from "@/lib/utils";

import { SourceError } from "./skill-source-error.js";

function SourceListRow({
  source,
  visibility,
  scannedAt,
  scanning,
  error,
  divided,
  onRescan,
  onRemove,
  onManageConnections,
}: {
  source: SkillSource;
  visibility?: "public" | "private";
  scannedAt?: string;
  scanning: boolean;
  error: ScanFailure | null;
  divided: boolean;
  onRescan: () => void;
  onRemove: () => void;
  onManageConnections?: () => void;
}) {
  const canRemove = !source.system && !source.fromTemplate;
  return (
    <div className={cn(divided && "border-t border-border")}>
      <div className="flex items-center gap-3 px-4 py-2.5">
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
        {scanning ? (
          <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
            <Spinner size={13} /> Scanning…
          </span>
        ) : (
          scannedAt &&
          !error && (
            <span
              className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground"
              title={formatTimestamp(scannedAt)}
            >
              <Time size={13} />
              scanned {timeAgo(scannedAt)}
            </span>
          )
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
      {error && !scanning && (
        <SourceError
          failure={error}
          onManageConnections={onManageConnections}
        />
      )}
    </div>
  );
}

function SourceListSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <Card>
      <div className="animate-pulse">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={cn("px-4 py-2.5", i > 0 && "border-t border-border")}
          >
            <p className="text-[15px] font-medium">
              <span className="inline-block h-[0.7em] w-40 rounded bg-muted align-middle" />
            </p>
            <p className="text-xs">
              <span className="inline-block h-[0.7em] w-56 rounded bg-muted/60 align-middle" />
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SkillSourceList({
  sources,
  loaded,
  visibilityBySource,
  scannedAtBySource,
  loadingBySource,
  errorBySource,
  onRescan,
  onRemove,
  onManageConnections,
}: {
  sources: SkillSource[];
  loaded: boolean;
  visibilityBySource: Record<string, "public" | "private">;
  scannedAtBySource: Record<string, string>;
  loadingBySource: Record<string, boolean>;
  errorBySource: Record<string, ScanFailure | null>;
  onRescan: (source: SkillSource) => void;
  onRemove: (source: SkillSource) => void;
  onManageConnections?: () => void;
}) {
  if (!loaded) return <SourceListSkeleton />;
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
          scanning={!!loadingBySource[source.id]}
          error={errorBySource[source.id] ?? null}
          divided={i > 0}
          onRescan={() => onRescan(source)}
          onRemove={() => onRemove(source)}
          onManageConnections={onManageConnections}
        />
      ))}
    </Card>
  );
}
