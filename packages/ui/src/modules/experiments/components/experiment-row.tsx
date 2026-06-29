import { ChevronRight } from "@carbon/icons-react";

import { Card } from "@/components/ui/card";

import type { ExperimentListEntry } from "../types.js";
import { ArmSwatches } from "./arm-swatches.js";
import { ExperimentStatusBadge } from "./experiment-status-badge.js";

interface Props {
  experiment: ExperimentListEntry;
  onSelect: () => void;
}

export function ExperimentRow({ experiment, onSelect }: Props) {
  const armCount = experiment.armAgentIds.length;
  return (
    <Card
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
      className="flex cursor-pointer items-center justify-between gap-4 p-4 transition-colors hover:border-foreground/20"
    >
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[16px] font-medium text-foreground">
          {experiment.name}
        </h2>
        <p className="mt-1 truncate text-[14px] text-muted-foreground">
          {experiment.prompt}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-[13px] text-muted-foreground">
        <ExperimentStatusBadge status={experiment.status} />
        <ArmSwatches agentIds={experiment.armAgentIds} />
        <span className="hidden tabular-nums sm:inline">
          {armCount} {armCount === 1 ? "arm" : "arms"}
        </span>
        <span className="hidden tabular-nums sm:inline">
          {experiment.runCount} {experiment.runCount === 1 ? "run" : "runs"}
        </span>
        <ChevronRight size={18} className="text-muted-foreground/60" />
      </div>
    </Card>
  );
}
