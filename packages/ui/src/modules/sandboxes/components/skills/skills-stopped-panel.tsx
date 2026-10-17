import type { ScanFailure, SkillSource } from "api-server-api";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/list-section";
import { timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { AgentSleepingCallout } from "../../../agents/components/agent-sleeping-callout.js";
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
  revalidatingBySource,
  errorBySource,
  addSourceButton,
  callout,
  disabledNotice,
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
  revalidatingBySource: Record<string, boolean>;
  errorBySource: Record<string, ScanFailure | null>;
  addSourceButton: ReactNode;
  callout?: ReactNode;
  disabledNotice?: ReactNode;
  comingUp: boolean;
  onStart: () => void;
  onRescan: (source: SkillSource) => void;
  onRemove: (source: SkillSource) => void;
  onManageConnections?: () => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      {callout && <div className="-mb-4">{callout}</div>}
      {disabledNotice ?? (
        <AgentSleepingCallout comingUp={comingUp} onStart={onStart}>
          — its skills are read-only until it wakes. Wake the agent to change
          them.
        </AgentSleepingCallout>
      )}

      <section>
        <SectionHeader label="Skills at next start" />
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
      </section>

      <section>
        <SectionHeader label="Connected sources">
          {addSourceButton}
        </SectionHeader>
        <SkillSourceList
          sources={sources}
          loaded={sourcesLoaded}
          visibilityBySource={visibilityBySource}
          scannedAtBySource={scannedAtBySource}
          loadingBySource={loadingBySource}
          revalidatingBySource={revalidatingBySource}
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
