import { Information, Play } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { SkillSourceList } from "./skills-source-list.js";

/** How many names a row spells out before it starts counting. A source with
 *  twenty installed skills would otherwise wrap the row four times and bury
 *  the rows under it. */
const MAX_CHIPS = 8;

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">
      {children}
    </span>
  );
}

/** One `label — chips` line of the snapshot. */
function SnapshotRow({
  label,
  divided,
  children,
}: {
  label: string;
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
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/**
 * The Skills surface while the sandbox is stopped: a dated snapshot of what was
 * on at the last run, over the live list of connected sources.
 *
 * Two different kinds of truth, so they are told apart rather than dimmed
 * together. The skills came from a recording and cannot change until the
 * sandbox runs again; the sources are account-scoped rows in Postgres, so they
 * stay accurate and editable. Search, bulk actions and toggles are left out
 * entirely — a greyed-out control on a dead surface still invites the click.
 */
export function SkillsStoppedPanel({
  capturedAt,
  onCount,
  rows,
  sources,
  visibilityBySource,
  scannedAtBySource,
  addSourceButton,
  comingUp,
  onStart,
  onRescan,
  onRemove,
}: {
  /** When the snapshot was taken. */
  capturedAt: string;
  onCount: number;
  rows: { label: string; names: string[] }[];
  sources: SkillSource[];
  visibilityBySource: Record<string, "public" | "private">;
  scannedAtBySource: Record<string, string>;
  /** The "Add source" control — sources stay editable while stopped. */
  addSourceButton: ReactNode;
  comingUp: boolean;
  onStart: () => void;
  onRescan: (source: SkillSource) => void;
  onRemove: (source: SkillSource) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
        <Information
          size={16}
          className="mt-px shrink-0 text-muted-foreground"
        />
        <p className="min-w-0 flex-1">
          <span className="font-semibold" title={formatTimestamp(capturedAt)}>
            Last known configuration, captured {timeAgo(capturedAt)}
          </span>{" "}
          <span className="text-muted-foreground">
            — the sandbox is stopped, so this is a snapshot rather than live
            state. Start the sandbox to change its skills.
          </span>
        </p>
        <Button
          size="sm"
          disabled={comingUp}
          onClick={onStart}
          className="shrink-0"
        >
          {comingUp ? <Spinner size={13} /> : <Play size={14} />}
          {comingUp ? "Starting…" : "Start sandbox"}
        </Button>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionLabel>Skills at last run</SectionLabel>
          <span
            className="text-sm text-muted-foreground"
            title={formatTimestamp(capturedAt)}
          >
            as of {timeAgo(capturedAt)}
          </span>
        </div>
        <Card>
          <SnapshotRow label="On" divided={false}>
            <span className="text-sm text-muted-foreground">
              {onCount} skill{onCount === 1 ? "" : "s"}
            </span>
          </SnapshotRow>
          {rows.map((row) => (
            <SnapshotRow key={row.label} label={row.label} divided>
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
          Search, bulk actions and per-skill toggles need the sandbox running —
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
          visibilityBySource={visibilityBySource}
          scannedAtBySource={scannedAtBySource}
          onRescan={onRescan}
          onRemove={onRemove}
        />
        <p className="mt-2.5 text-sm text-muted-foreground">
          Sources and their scan times are platform-side, so they stay accurate
          and editable while stopped.
        </p>
      </section>
    </div>
  );
}
