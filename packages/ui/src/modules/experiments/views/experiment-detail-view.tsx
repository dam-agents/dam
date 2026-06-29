import { ArrowLeft, Renew, StopFilledAlt } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useStartExperiment, useStopExperiment } from "../api/mutations.js";
import { useExperiment } from "../api/queries.js";
import { ArmLedger } from "../components/arm-ledger.js";
import { ExperimentStatusBadge } from "../components/experiment-status-badge.js";
import { useAgentLabels } from "../hooks/use-agent-labels.js";

export function ExperimentDetailView() {
  const experimentId = useStore((s) => s.experimentId);
  const navigateToExperiments = useStore((s) => s.navigateToExperiments);
  const {
    data: experiment,
    isError,
    isFetching,
    refetch,
  } = useExperiment(experimentId);
  const agentLabels = useAgentLabels();
  const start = useStartExperiment();
  const stop = useStopExperiment();

  if (!experimentId) return null;

  if (!experiment) {
    return (
      <div>
        <BackLink onClick={navigateToExperiments} />
        <p className="mt-6 text-[14px] text-muted-foreground">
          {isError ? "Couldn't load this experiment." : "Loading…"}
        </p>
      </div>
    );
  }

  const runCount = experiment.arms.reduce((n, arm) => n + arm.runs.length, 0);
  const actionPending = start.isPending || stop.isPending;

  return (
    <div>
      <BackLink onClick={navigateToExperiments} />

      <div className="mt-4 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.5px] text-foreground">
            {experiment.name}
          </h1>
          <p className="mt-1 max-w-[70ch] whitespace-pre-wrap text-[14px] text-muted-foreground">
            {experiment.prompt}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
            <ExperimentStatusBadge status={experiment.status} />
            <span>
              {experiment.arms.length}{" "}
              {experiment.arms.length === 1 ? "arm" : "arms"}
            </span>
            <span>·</span>
            <span>{runCount} runs total</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <Renew size={15} className={cn(isFetching && "animate-spin")} />
            Refresh
          </Button>
          {experiment.status === "running" ? (
            <Button
              variant="outline"
              tone="danger"
              size="sm"
              disabled={actionPending}
              onClick={() => stop.mutate({ id: experiment.id })}
            >
              <StopFilledAlt size={15} />
              Stop
            </Button>
          ) : experiment.status !== "completed" ? (
            <Button
              size="sm"
              disabled={actionPending}
              onClick={() => start.mutate({ id: experiment.id })}
            >
              Start
            </Button>
          ) : null}
        </div>
      </div>

      <p className="mt-6 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
        Each arm is a framework + config. Scores are reported as-is and{" "}
        <b className="font-medium text-foreground">
          not normalized across arms
        </b>{" "}
        — compare within an arm.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {experiment.arms.map((arm) => {
          const label = agentLabels.get(arm.agentId);
          return (
            <ArmLedger
              key={arm.agentId}
              experimentId={experiment.id}
              arm={arm}
              agentName={label?.name ?? null}
              templateName={label?.templateName ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft size={15} />
      Experiments
    </button>
  );
}
