import type { Experiment } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { useAgentsList } from "../../agents/api/queries.js";
import { useArtifacts } from "../../artifacts/api/queries.js";
import { ArtifactPreviewDialog } from "../../artifacts/components/artifact-preview-dialog.js";
import { useExperimentFeed, useExperiments } from "../api/queries.js";
import { ExperimentStatusBadge } from "./experiment-status-badge.js";

/** Cap the expanded run list — old runs stay reachable via the library. */
const EXPANDED_RUNS_MAX = 10;

export function LineageRuns({
  driverAgentId,
  name,
}: {
  driverAgentId: string;
  name: string;
}) {
  const { data: experiments } = useExperiments();
  // Titles for the runs' artifact chips — one cached library query.
  const { data: artifacts } = useArtifacts();
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(
    null,
  );
  if (!experiments)
    return (
      <p className="border-t border-border py-3.5 pl-12 pr-[18px] text-sm text-muted-foreground">
        Loading runs…
      </p>
    );
  const lineage = experiments.filter(
    (e) => e.driverAgentId === driverAgentId && e.name === name,
  );
  const draft = lineage.find((e) => e.status === "draft");
  // list() is newest-first; run numbers count from the oldest.
  const runs = lineage.filter((e) => e.status !== "draft");
  const shown = runs.slice(0, EXPANDED_RUNS_MAX);
  return (
    <div className="border-t border-border">
      {runs.length === 0 && (
        <p className="py-3.5 pl-12 pr-[18px] text-sm text-muted-foreground">
          No runs yet — open the chat and start one from the draft panel.
        </p>
      )}
      {shown.map((run, index) => (
        <RunRow
          key={run.id}
          run={run}
          number={runs.length - index}
          draftDashboardArtifactId={draft?.dashboardArtifactId ?? null}
          artifactTitles={
            new Map((artifacts ?? []).map((a) => [a.id, a.title]))
          }
          onOpenArtifact={setPreviewArtifactId}
        />
      ))}
      {runs.length > shown.length && (
        <p className="pb-2.5 pl-12 pr-[18px] text-xs text-muted-foreground">
          {runs.length - shown.length} older run
          {runs.length - shown.length === 1 ? "" : "s"} in the artifact library.
        </p>
      )}
      {previewArtifactId && (
        <ArtifactPreview
          artifactId={previewArtifactId}
          onClose={() => setPreviewArtifactId(null)}
        />
      )}
    </div>
  );
}

function RunRow({
  run,
  number,
  draftDashboardArtifactId,
  artifactTitles,
  onOpenArtifact,
}: {
  run: Experiment;
  number: number;
  draftDashboardArtifactId: string | null;
  artifactTitles: Map<string, string>;
  onOpenArtifact: (artifactId: string) => void;
}) {
  // Lazy by construction: this row only exists while its card is expanded.
  // The feed poll keeps the dots moving for a live run and stops when
  // terminal (useExperimentFeed's poll-while-live behavior).
  const { data: feed } = useExperimentFeed(run.id);
  const startedAt = run.executedAt ?? run.createdAt;
  // A live run still points at the draft's renderer; its own results
  // artifact only exists after the terminal snapshot repointed it.
  const resultsArtifactId =
    run.status !== "running" &&
    run.dashboardArtifactId !== null &&
    run.dashboardArtifactId !== draftDashboardArtifactId
      ? run.dashboardArtifactId
      : null;
  // Everything else the run produced or referenced: span-referenced
  // candidates, driver-attached reports, invocation-target publishes. The
  // renderer/results id has its own button; the script clone is stock and
  // stays in the library folder. Deleted artifacts drop out (no title).
  const extraArtifacts = (feed?.artifactIds ?? [])
    .filter(
      (id) =>
        id !== run.dashboardArtifactId &&
        id !== draftDashboardArtifactId &&
        id !== run.scriptArtifactId,
    )
    .map((id) => ({ id, title: artifactTitles.get(id) }))
    .filter((a): a is { id: string; title: string } => a.title !== undefined);
  return (
    <div className="border-t border-border py-3.5 pl-12 pr-[18px] first:border-t-0">
      {/* Fixed-width columns so Run #, status, timestamp and the invocation area
          line up across every row of the lineage. */}
      <div className="flex items-center gap-3.5 text-sm">
        <span className="w-12 shrink-0 font-semibold text-foreground">
          Run {number}
        </span>
        <span className="flex w-[100px] shrink-0">
          <ExperimentStatusBadge status={run.status} />
        </span>
        <span className="w-[150px] shrink-0 text-[12.5px] text-muted-foreground">
          {formatDateTime(startedAt, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <InvocationDots invocations={feed?.invocations} />
        <span className="min-w-0 flex-1" />
        {resultsArtifactId && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onOpenArtifact(resultsArtifactId)}
          >
            Results
          </Button>
        )}
      </div>
      {extraArtifacts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {extraArtifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onOpenArtifact(artifact.id)}
              title={artifact.title}
              className="max-w-[220px] truncate rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            >
              {artifact.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The run's subagent invocations at a glance: one dot each (running pulses
 *  blue, done green, failed red), capped, with the total alongside. */
const INVOCATION_DOTS_MAX = 12;

function InvocationDots({
  invocations,
}: {
  invocations: { id: string; status: string }[] | undefined;
}) {
  // One shared cached query — a "running" invocation whose target agent is
  // parked over-budget (#1900) hasn't actually started; show it amber.
  const agents = useAgentsList();
  if (!invocations || invocations.length === 0) return null;
  const stateById = new Map(agents.map((a) => [a.id, a.state]));
  const waitingForRoom = (i: { id: string; status: string }) =>
    i.status === "running" && stateById.get(i.id) === "over_budget";
  const shown = invocations.slice(0, INVOCATION_DOTS_MAX);
  const waiting = invocations.filter(waitingForRoom).length;
  const running =
    invocations.filter((i) => i.status === "running").length - waiting;
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center gap-[3px]">
        {shown.map((invocation) => (
          <span
            key={invocation.id}
            className={cn(
              "size-[6px] rounded-full",
              waitingForRoom(invocation)
                ? "animate-pulse bg-amber-500"
                : invocation.status === "running"
                  ? "animate-pulse bg-emerald-500"
                  : invocation.status === "failed"
                    ? "bg-red-500"
                    : "bg-muted-foreground/45",
            )}
          />
        ))}
        {invocations.length > shown.length && (
          <span className="text-[11px] text-muted-foreground">
            +{invocations.length - shown.length}
          </span>
        )}
      </span>
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
        {invocations.length} invocation{invocations.length === 1 ? "" : "s"}
        {running > 0 && ` · ${running} running`}
        {waiting > 0 && ` · ${waiting} waiting for room`}
      </span>
    </span>
  );
}

/** Run artifacts open in the library's preview dialog; the artifact object
 *  is looked up lazily — this component only mounts after a click. */
function ArtifactPreview({
  artifactId,
  onClose,
}: {
  artifactId: string;
  onClose: () => void;
}) {
  const { data: artifacts } = useArtifacts();
  const artifact = artifacts?.find((a) => a.id === artifactId);
  if (!artifact) return null;
  return <ArtifactPreviewDialog artifact={artifact} onClose={onClose} />;
}
