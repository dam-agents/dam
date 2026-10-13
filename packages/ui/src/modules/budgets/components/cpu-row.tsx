import type { BudgetVmUsage } from "api-server-api";

import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { formatCores } from "../lib/format.js";
import { topCpuAgents } from "../lib/pools.js";

interface Props {
  usage: BudgetVmUsage;
  agents: readonly AgentView[];
}

export function CpuRow({ usage, agents }: Props) {
  const slowed = usage.cpu?.slowed ?? false;
  const top = topCpuAgents(usage, agents);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-foreground">CPU</span>
        <span
          className={cn(
            "text-muted-foreground",
            slowed && "font-semibold text-warning",
          )}
        >
          {slowed ? "Slowed down" : "Not slowed down"}
        </span>
      </div>
      {slowed && (
        <p className="text-muted-foreground">
          Your agents asked for more CPU than your pool has.
          {top.length > 0 &&
            ` Using the most: ${top
              .map((t) => `${t.agent.name} (${formatCores(t.cpuMilli)} CPU)`)
              .join(", ")}.`}
        </p>
      )}
    </div>
  );
}
