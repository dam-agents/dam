import { Information, Play } from "@carbon/icons-react";
import type { ScanFailure, SkillSource } from "api-server-api";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";
import { timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { SkillSourceList } from "./skills-source-list.js";

const MAX_CHIPS = 8;

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function SnapshotRow({
  label,
  note,
  divided,
  children,
}: {
  label: string;
  note?: string;
  divided: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-4 px-4 py-2.5",
        divided && "border-t border-border",
      )}
    >
      <span className="w-40 shrink-0 text-sm font-medium text-foreground">
        {label}
        {note && (
          <span className="block text-xs font-normal text-muted-foreground">
            {note}
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function SkillsStoppedPanel({
  onCount,
  rows,
  sources,
  sourcesLoaded,
  visibilityBySource,
  scannedAtBySource,
  loadingBySource,
  errorBySource,
  addSourceButton,
  callout,
  comingUp,
  onStart,
  onRescan,
  onRemove,
  onManageConnections,
}: {
  onCount: number;
  rows: { label: string; names: string[]; capturedAt?: string }[];
  sources: SkillSource[];
  sourcesLoaded: boolean;
  visibilityBySource: Record<string, "public" | "private">;
  scannedAtBySource: Record<string, string>;
  loadingBySource: Record<string, boolean>;
  errorBySource: Record<string, ScanFailure | null>;
  addSourceButton: ReactNode;
  callout?: ReactNode;
  comingUp: boolean;
  onStart: () => void;
  onRescan: (source: SkillSource) => void;
  onRemove: (source: SkillSource) => void;
  onManageConnections?: () => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      {callout && <div className="-mb-4">{callout}</div>}
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
        <Information
          size={16}
          className="mt-px shrink-0 text-muted-foreground"
        />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">This agent is stopped</span>{" "}
          <span className="text-muted-foreground">
            — its skills are read-only until it runs again. Start the agent to
            change them.
          </span>
        </p>
        <Button
          size="sm"
          disabled={comingUp}
          onClick={onStart}
          className="shrink-0"
        >
          {comingUp ? <Spinner size={13} /> : <Play size={14} />}
          {comingUp ? "Starting…" : "Start agent"}
        </Button>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionLabel>Skills at next start</SectionLabel>
        </div>
        <Card>
          <SnapshotRow label="On" divided={false}>
            <span className="text-sm text-muted-foreground">
              {onCount} skill{onCount === 1 ? "" : "s"}
            </span>
          </SnapshotRow>
          {rows.map((row) => (
            <SnapshotRow
              key={row.label}
              label={row.label}
              note={
                row.capturedAt
                  ? `recorded ${timeAgo(row.capturedAt)}`
                  : undefined
              }
              divided
            >
              {row.names.slice(0, MAX_CHIPS).map((name) => (
                <Chip key={name}>{name}</Chip>
              ))}
              {row.names.length > MAX_CHIPS && (
                <Chip>+{row.names.length - MAX_CHIPS}</Chip>
              )}
            </SnapshotRow>
          ))}
        </Card>
        <p className="mt-2.5 text-sm text-muted-foreground">
          Search, bulk actions and per-skill toggles need the agent running —
          they&rsquo;re left out here rather than shown greyed out.
        </p>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionLabel>Connected sources</SectionLabel>
          {addSourceButton}
        </div>
        <SkillSourceList
          sources={sources}
          loaded={sourcesLoaded}
          visibilityBySource={visibilityBySource}
          scannedAtBySource={scannedAtBySource}
          loadingBySource={loadingBySource}
          errorBySource={errorBySource}
          onRescan={onRescan}
          onRemove={onRemove}
          onManageConnections={onManageConnections}
        />
        <p className="mt-2.5 text-sm text-muted-foreground">
          Sources stay editable while stopped. Reading what a private one
          contains needs the agent running.
        </p>
      </section>
    </div>
  );
}
