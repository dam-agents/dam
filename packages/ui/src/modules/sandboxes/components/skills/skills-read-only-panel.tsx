import { Add, Information, Play } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/list-section";
import { Notice } from "@/components/ui/notice";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";
import { timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { AgentSleepingCallout } from "../../../agents/components/agent-sleeping-callout.js";
import type { SkillsDerivations } from "../../hooks/use-skills-derivations.js";
import type { SkillsSurface } from "../../hooks/use-skills-surface.js";
import { AddSourceRow } from "./skill-sources-section.js";
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

export function SkillsReadOnlyPanel({
  surface,
  derived,
  mode,
  comingUp,
  disabledNotice,
  onStart,
  onAddSource,
  onRemove,
  onManageConnections,
}: {
  surface: SkillsSurface;
  derived: SkillsDerivations;
  mode: "never-run" | "stopped";
  comingUp: boolean;
  disabledNotice?: ReactNode;
  onStart: () => void;
  onAddSource: () => void;
  onRemove: (source: SkillSource) => void;
  onManageConnections?: (() => void) | undefined;
}) {
  const {
    sources,
    sourcesLoaded,
    visibilityBySource,
    scannedAtBySource,
    loadingBySource,
    revalidatingBySource,
    errorBySource,
  } = surface;
  const { snapshotOnCount, snapshotRows } = derived;

  const startButton = !disabledNotice && (
    <Button size="sm" disabled={comingUp} onClick={onStart}>
      {comingUp ? <Spinner size={14} /> : <Play size={14} />}
      {comingUp ? "Starting…" : "Start agent"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      {disabledNotice ??
        (mode === "never-run" ? (
          <Notice
            icon={Information}
            title="This agent hasn’t run yet"
            action={startButton}
          >
            — its skills are resolved when it starts, so there&rsquo;s nothing
            recorded to show. Start it once and this page fills in.
          </Notice>
        ) : (
          <AgentSleepingCallout comingUp={comingUp} onStart={onStart}>
            — its skills are read-only until it wakes. Wake the agent to change
            them.
          </AgentSleepingCallout>
        ))}

      {mode === "never-run" ? (
        <section>
          <SectionLabel spaced>Skills</SectionLabel>
          <Callout variant="dashed">
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Not known yet — start the agent to see and configure its skills.
              </p>
              <div className="flex items-center gap-2">
                {startButton}
                <Button variant="outline" size="sm" onClick={onAddSource}>
                  <Add size={16} /> Add source
                </Button>
              </div>
            </div>
          </Callout>
        </section>
      ) : (
        <section>
          <SectionHeader label="Skills at next start" />
          <Card>
            <SnapshotRow label="On" divided={false}>
              <span className="text-sm text-muted-foreground">
                {snapshotOnCount} skill{snapshotOnCount === 1 ? "" : "s"}
              </span>
            </SnapshotRow>
            {snapshotRows.map((row) => (
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
      )}

      <section>
        <SectionHeader label="Connected sources" />
        <SkillSourceList
          sources={sources}
          loaded={sourcesLoaded}
          visibilityBySource={visibilityBySource}
          scannedAtBySource={scannedAtBySource}
          loadingBySource={loadingBySource}
          revalidatingBySource={revalidatingBySource}
          errorBySource={errorBySource}
          onRescan={(src) => void surface.refreshSource(src.id)}
          onRemove={onRemove}
          onManageConnections={onManageConnections}
        />
        {sourcesLoaded && (
          <Card className="mt-3 overflow-hidden">
            <AddSourceRow onClick={onAddSource} />
          </Card>
        )}
        <p className="mt-2.5 text-sm text-muted-foreground">
          {mode === "never-run"
            ? "The source list is known before first boot; which of its skills are installed isn&rsquo;t."
            : "Sources stay editable while stopped. Reading what a private one contains needs the agent running."}
        </p>
      </section>
    </div>
  );
}
