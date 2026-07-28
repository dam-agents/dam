import type { Experiment, TraceFeed } from "api-server-api";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useArtifacts } from "../../artifacts/api/queries.js";
import { listAgentSessions } from "../../sessions/api/acp-session-ops.js";
import { useStartRun, useStopExperiment } from "../api/mutations.js";
import { useExperimentFeed } from "../api/queries.js";
import { DashboardCanvas } from "./dashboard-canvas.js";
import { ExperimentStatusBadge } from "./experiment-status-badge.js";

/** The launch session opens agent-side (runtime channel), so its id isn't in
 *  the start-run response — poll the agent's session list briefly and switch
 *  the chat to it, so the user follows the launch turn next to the graph.
 *  A pendingLaunch record covers the wait (pod wake can take a while):
 *  Start buttons disable and the sidebar shows a skeleton run row. */
async function openLaunchSession(
  agentId: string,
  experimentId: string,
): Promise<void> {
  const store = useStore.getState();
  store.setPendingLaunch({ agentId, runId: experimentId });
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const sessions = await listAgentSessions(agentId);
        const launch = sessions.find((s) => s.experimentId === experimentId);
        if (launch) {
          // Clear BEFORE opening: the chat's pending-launch takeover resets
          // whatever session is open, and must never race the real one.
          useStore.getState().clearPendingLaunch(experimentId);
          useStore.getState().openAgentSession(agentId, launch.sessionId);
          return;
        }
      } catch {
        // The pod may still be waking from the launch poke; keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    emitToast({
      kind: "error",
      message:
        "The run's session hasn't appeared yet — check the agent's Experiment runs list.",
    });
  } finally {
    useStore.getState().clearPendingLaunch(experimentId);
  }
}

/** The experiment surface in the chat dock. Building and running are
 *  separate lifecycles with separate lenses: a DRAFT panel shows the plan
 *  (skeleton dashboard) with "Start a new run" and nothing else; a RUN
 *  panel shows only that run — the draft's renderer fed live data (its own
 *  results artifact once terminal), Stop while live, and the run's
 *  artifacts. */
export function ExperimentDockPanel({
  experiment,
  options = [],
  onSelect,
  onClose,
}: {
  experiment: Experiment;
  /** The agent's other dockable experiments — >1 renders a switcher. */
  options?: Experiment[];
  onSelect?: (id: string) => void;
  /** Only the artifact-doorway variant closes (back to the normal dock);
   *  the persistent panel has no close — dismissing it left no obvious way
   *  to reopen the dashboard. */
  onClose?: () => void;
}) {
  const isDraft = experiment.status === "draft";
  const { data: feed } = useExperimentFeed(experiment.id);
  const startRun = useStartRun();
  const stop = useStopExperiment();
  const status = feed?.experiment.status ?? experiment.status;
  // A launch in flight for THIS agent disables starting anything else on it
  // until its session appears — the wait spans a pod wake, and an enabled
  // button there invites an accidental second run.
  const pendingLaunch = useStore((s) => s.pendingLaunch);
  const launching =
    startRun.isPending || pendingLaunch?.agentId === experiment.driverAgentId;

  const startRunButton = (
    <Button
      size="xs"
      onClick={() =>
        startRun.mutate(
          { id: experiment.id },
          {
            // startRun returns the fresh run — follow its launch session;
            // the run panel takes over via the session binding.
            onSuccess: (run) =>
              void openLaunchSession(run.driverAgentId, run.id),
          },
        )
      }
      disabled={launching}
    >
      {launching ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          Starting…
        </>
      ) : (
        "Start a new run"
      )}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[48px] shrink-0 items-center gap-2 border-b border-border-light px-4">
        {options.length > 1 && onSelect ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[13px] font-medium text-foreground hover:text-foreground/80"
                title="Switch experiment"
              >
                <span className="min-w-0 truncate">
                  {experiment.name}
                  {isDraft && (
                    <span className="ml-1 text-muted-foreground">(draft)</span>
                  )}
                </span>
                <ChevronDown
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {options.map((option) => (
                <DropdownMenuItem
                  key={option.id}
                  onSelect={() => onSelect(option.id)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {option.status}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
            title={experiment.name}
          >
            {experiment.name}
            {isDraft && (
              <span className="ml-1 text-muted-foreground">(draft)</span>
            )}
          </span>
        )}
        {!isDraft && <ExperimentStatusBadge status={status} />}
        {isDraft && startRunButton}
        {!isDraft && status === "running" && (
          <Button
            variant="destructive"
            size="xs"
            onClick={() => stop.mutate({ id: experiment.id })}
            disabled={stop.isPending}
          >
            Stop
          </Button>
        )}
        {!isDraft && status !== "running" && startRunButton}
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Close"
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        )}
      </div>

      {!isDraft &&
        status === "failed" &&
        (feed?.experiment.error ?? experiment.error) && (
          <p className="border-b border-border-light px-4 py-2 text-[12px] text-red-600 dark:text-red-400">
            {feed?.experiment.error ?? experiment.error}
          </p>
        )}

      <div className="min-h-0 flex-1">
        <DashboardCanvas
          dashboardArtifactId={experiment.dashboardArtifactId}
          feed={feed}
        />
      </div>

      {!isDraft && <RunInvocations feed={feed} />}
      {!isDraft && <RunArtifacts experiment={experiment} feed={feed} />}
    </div>
  );
}

/** The run's Invocations — one row per spawned subagent, running first.
 *  An invocation's id IS its target agent's id (report_result attribution),
 *  so a click opens that subagent's chat directly; targets already reaped
 *  render inert. Stage labels join through the recent-spans window and
 *  degrade to nothing for spans that scrolled out of it. */
function RunInvocations({ feed }: { feed: TraceFeed | undefined }) {
  const selectAgent = useStore((s) => s.selectAgent);
  const agents = useAgentsList();
  const invocations = feed?.invocations ?? [];
  const rows = useMemo(() => {
    const agentById = new Map(agents.map((a) => [a.id, a]));
    const stageBySpan = new Map(
      (feed?.recentSpans ?? []).map((s) => [s.spanId, s.stage]),
    );
    const rank = (status: string) => (status === "running" ? 0 : 1);
    return invocations
      .map((invocation) => ({
        ...invocation,
        agentName: agentById.get(invocation.id)?.name ?? null,
        // The invocation row says "running", but a target parked by the
        // budget gate (#1900) hasn't started — show the wait honestly. The
        // controller auto-retries sweepable targets, so this resolves by
        // itself once room frees.
        waitingForRoom:
          invocation.status === "running" &&
          agentById.get(invocation.id)?.state === "over_budget",
        stage: invocation.spanId
          ? (stageBySpan.get(invocation.spanId) ?? null)
          : null,
      }))
      .sort((a, b) => rank(a.status) - rank(b.status));
  }, [invocations, agents, feed?.recentSpans]);

  if (rows.length === 0) return null;
  return (
    <div className="max-h-[160px] shrink-0 overflow-y-auto border-t border-border-light px-4 py-2">
      <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Invocations
      </p>
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          disabled={row.agentName === null}
          onClick={() => selectAgent(row.id)}
          className={cn(
            "flex w-full items-center gap-2 py-0.5 text-left text-[13px]",
            row.agentName === null
              ? "cursor-default text-muted-foreground"
              : "text-foreground/90 hover:text-foreground hover:underline",
          )}
          title={
            row.agentName === null
              ? "This subagent has already been cleaned up"
              : "Open the subagent's chat"
          }
        >
          <span
            className={cn(
              "size-[7px] shrink-0 rounded-full",
              // Invocation statuses: running | done | failed.
              row.waitingForRoom
                ? "animate-pulse bg-amber-500"
                : row.status === "running"
                  ? "animate-pulse bg-emerald-500"
                  : row.status === "failed"
                    ? "bg-red-500"
                    : "bg-muted-foreground/45",
            )}
          />
          <span className="min-w-0 flex-1 truncate">
            {row.agentName ?? (
              <>
                {row.id.slice(0, 8)}…{" "}
                <span className="italic text-muted-foreground">(deleted)</span>
              </>
            )}
          </span>
          {row.stage && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {row.stage}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {row.waitingForRoom ? "waiting for room" : row.status}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The run's own artifacts: its frozen script clone plus everything the
 *  feed attributes structurally — span-referenced candidates, driver
 *  attaches (create_artifact experiment_id=), and invocation-target
 *  publishes (auto-attributed). The renderer/results artifact is the canvas
 *  above, so it isn't repeated here. */
function RunArtifacts({
  experiment,
  feed,
}: {
  experiment: Experiment;
  feed: TraceFeed | undefined;
}) {
  const setOpenArtifactId = useStore((s) => s.setOpenArtifactId);
  const { data: artifacts } = useArtifacts();
  const runArtifacts = useMemo(() => {
    if (!artifacts) return [];
    const attributed = new Set([
      experiment.scriptArtifactId,
      ...(feed?.artifactIds ?? []),
    ]);
    return artifacts.filter(
      (a) => a.id !== experiment.dashboardArtifactId && attributed.has(a.id),
    );
  }, [feed, artifacts, experiment]);

  if (runArtifacts.length === 0) return null;
  return (
    <div className="max-h-[160px] shrink-0 overflow-y-auto border-t border-border-light px-4 py-2">
      <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Run artifacts
      </p>
      {runArtifacts.map((artifact) => (
        <button
          key={artifact.id}
          type="button"
          onClick={() => setOpenArtifactId(artifact.id)}
          className="block w-full truncate py-0.5 text-left text-[13px] text-foreground/90 hover:text-foreground hover:underline"
          title={artifact.title}
        >
          {artifact.title}
        </button>
      ))}
    </div>
  );
}
