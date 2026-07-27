import type {
  Experiment,
  ExperimentDriverSummary,
  ExperimentStatus,
} from "api-server-api";
import { ChevronDown, MoreVertical, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useArtifacts } from "../../artifacts/api/queries.js";
import { ArtifactPreviewDialog } from "../../artifacts/components/artifact-preview-dialog.js";
import { useDeleteExperiment } from "../api/mutations.js";
import {
  useDriverSummaries,
  useExperimentFeed,
  useExperiments,
} from "../api/queries.js";
import { ExperimentStatusBadge } from "../components/experiment-status-badge.js";

/** One row of the destination: a lineage (driver + name) rolled up from its
 *  draft and runs. The experiment is the unit the user thinks in — the agent
 *  is the venue, listed as secondary metadata. */
interface LineageRow {
  key: string;
  driverAgentId: string;
  name: string;
  runCount: number;
  liveCount: number;
  /** Live wins, else the newest run's status, else draft. */
  badge: ExperimentStatus;
  /** Driver-level running-invocation count, shown on live lineages. */
  runningInvocations: number;
  /** createdAt of the lineage's newest row — the recency sort key. */
  newestAt: string;
  /** Every experiment row in the lineage (draft + runs) — the delete set. */
  experimentIds: string[];
}

function toLineages(summaries: ExperimentDriverSummary[]): LineageRow[] {
  const rows: LineageRow[] = [];
  for (const summary of summaries) {
    const byName = new Map<string, ExperimentDriverSummary["experiments"]>();
    for (const e of summary.experiments) {
      byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
    }
    for (const [name, experiments] of byName) {
      // Summary order is newest-first already.
      const runs = experiments.filter((e) => e.status !== "draft");
      const live = runs.filter((e) => e.status === "running");
      rows.push({
        key: `${summary.driverAgentId}\n${name}`,
        driverAgentId: summary.driverAgentId,
        name,
        runCount: runs.length,
        liveCount: live.length,
        badge: live[0]?.status ?? runs[0]?.status ?? "draft",
        runningInvocations: live.length > 0 ? summary.runningInvocations : 0,
        newestAt: experiments[0]?.createdAt ?? "",
        experimentIds: experiments.map((e) => e.id),
      });
    }
  }
  return rows.sort((a, b) => {
    if (a.liveCount > 0 !== b.liveCount > 0) return a.liveCount > 0 ? -1 : 1;
    return b.newestAt.localeCompare(a.newestAt);
  });
}

/** The Experiments destination lists experiments (lineages), not agents:
 *  each row is one named loop with its run history rolled up; clicking lands
 *  in the driver agent's chat, where the live panel docks. A lineage whose
 *  driver agent was deleted stays listed — its results artifacts outlive the
 *  agent — but can't route anywhere. */
export function ExperimentsListView() {
  const { data } = useDriverSummaries();
  const selectAgent = useStore((s) => s.selectAgent);
  const agents = useAgentsList();
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const deleteExperiment = useDeleteExperiment();
  const [deleteTarget, setDeleteTarget] = useState<LineageRow | null>(null);

  const lineages = toLineages(data ?? []);
  // Gate on data presence, not query success, so a transient refetch failure
  // keeps the cached list rendered instead of flashing skeletons over it.
  const initialLoaded = data !== undefined;

  return (
    <div>
      <PageHeader
        title="Experiments"
        description="Loop scripts the platform observes live. Open one to land in its agent's chat — the experiment graph docks beside the conversation."
      />

      {!initialLoaded && <ListSkeleton rows={3} rowHeight={72} />}

      {initialLoaded && lineages.length === 0 && (
        <Card className="p-10 text-center">
          <p className="text-[14px] text-muted-foreground">
            No experiments yet. Ask an agent to author one — it registers the
            plan and shows up here.
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {lineages.map((lineage) => (
          <LineageCard
            key={lineage.key}
            lineage={lineage}
            agentName={agentName.get(lineage.driverAgentId)}
            agentsLoaded={agents.length > 0}
            onSelect={() => selectAgent(lineage.driverAgentId)}
            onDelete={() => setDeleteTarget(lineage)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        kind="destructive"
        title={`Delete experiment “${deleteTarget?.name}”?`}
        description="The draft and all its runs are removed. Artifacts already published to the library (scripts, results) are kept."
        confirmLabel="Delete"
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          void (async () => {
            // Sequential: each id is one row; failures toast individually
            // and the rest still go.
            for (const id of target.experimentIds) {
              await deleteExperiment.mutateAsync({ id }).catch(() => {});
            }
          })();
        }}
      />
    </div>
  );
}

function LineageCard({
  lineage,
  agentName,
  agentsLoaded,
  onSelect,
  onDelete,
}: {
  lineage: LineageRow;
  agentName: string | undefined;
  /** Until the agents list arrives, a missing name means "still loading",
   *  not "deleted" — don't flash the deleted state. */
  agentsLoaded: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const agentDeleted = agentsLoaded && agentName === undefined;
  const parts = [
    agentDeleted ? "agent deleted" : (agentName ?? "…"),
    `${lineage.runCount} run${lineage.runCount === 1 ? "" : "s"}`,
  ];
  if (lineage.liveCount > 0) parts.push(`${lineage.liveCount} live`);
  if (lineage.runningInvocations > 0)
    parts.push(
      `${lineage.runningInvocations} running invocation${lineage.runningInvocations === 1 ? "" : "s"}`,
    );
  if (agentDeleted) parts.push("results remain in the artifact library");
  return (
    <Card className={cn("overflow-hidden", agentDeleted && "opacity-70")}>
      <div
        role={agentDeleted ? undefined : "button"}
        tabIndex={agentDeleted ? undefined : 0}
        onClick={agentDeleted ? undefined : onSelect}
        onKeyDown={(e) => !agentDeleted && e.key === "Enter" && onSelect()}
        className={cn(
          "flex items-center justify-between gap-4 p-4",
          !agentDeleted && "cursor-pointer transition-colors hover:bg-muted/50",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          title={expanded ? "Collapse runs" : "Show runs"}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
        >
          <ChevronDown
            size={16}
            className={cn(
              "text-muted-foreground transition-transform",
              !expanded && "-rotate-90",
            )}
          />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-foreground">
            {lineage.name}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {parts.join(" · ")}
          </p>
        </div>
        <ExperimentStatusBadge status={lineage.badge} />
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="More actions">
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                tone="danger"
                disabled={lineage.liveCount > 0}
                title={
                  lineage.liveCount > 0
                    ? "Stop the live run before deleting"
                    : undefined
                }
                onSelect={onDelete}
              >
                <Trash2 size={14} />
                Delete experiment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Mounted only when expanded, so the run details and per-run feeds
          are fetched lazily, card by card. */}
      {expanded && (
        <LineageRuns
          driverAgentId={lineage.driverAgentId}
          name={lineage.name}
        />
      )}
    </Card>
  );
}

/** Cap the expanded run list — old runs stay reachable via the library. */
const EXPANDED_RUNS_MAX = 10;

function LineageRuns({
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
      <p className="border-t border-border-light px-4 py-3 text-[13px] text-muted-foreground">
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
    <div className="border-t border-border-light">
      {runs.length === 0 && (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">
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
        <p className="px-4 pb-2 text-[12px] text-muted-foreground">
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
    <div className="border-t border-border-light/60 px-4 py-2 first:border-t-0">
      <div className="flex items-center gap-3">
        <span className="whitespace-nowrap text-[13px] font-medium text-foreground">
          Run {number}
        </span>
        <ExperimentStatusBadge status={run.status} />
        <span className="whitespace-nowrap text-[12px] text-muted-foreground">
          {new Date(startedAt).toLocaleString(undefined, {
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
              className="max-w-[220px] truncate rounded-md border border-border-light bg-muted/40 px-2 py-0.5 text-[11px] text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
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
                  ? "animate-pulse bg-blue-500"
                  : invocation.status === "failed"
                    ? "bg-red-500"
                    : "bg-emerald-500",
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
