import { Time } from "@carbon/icons-react";
import type { ScanFailure, SkillSource } from "api-server-api";

import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { SourceError } from "./skill-source-error.js";
import {
  SkillSourceActions,
  SkillSourceHeader,
} from "./skill-source-header.js";

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
  onRemove?: () => void;
  onManageConnections?: () => void;
}) {
  return (
    <div className={cn(divided && "border-t border-border")}>
      <SkillSourceHeader source={source} visibility={visibility}>
        {scanning ? (
          <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
            <Spinner size={14} /> Scanning…
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
        <SkillSourceActions
          source={source}
          busy={scanning}
          onRescan={onRescan}
          onRemove={onRemove}
        />
      </SkillSourceHeader>
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
            <p className="text-md font-medium">
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
  revalidatingBySource,
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
  revalidatingBySource: Record<string, boolean>;
  errorBySource: Record<string, ScanFailure | null>;
  onRescan: (source: SkillSource) => void;
  onRemove?: (source: SkillSource) => void;
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
          scanning={
            !!loadingBySource[source.id] || !!revalidatingBySource[source.id]
          }
          error={errorBySource[source.id] ?? null}
          divided={i > 0}
          onRescan={() => onRescan(source)}
          onRemove={onRemove && (() => onRemove(source))}
          onManageConnections={onManageConnections}
        />
      ))}
    </Card>
  );
}
