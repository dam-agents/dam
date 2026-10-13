import type { BudgetVmUsage, PoolLevel } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { formatCores } from "../lib/format.js";
import { cpuPressureBar, topCpuAgents } from "../lib/pools.js";
import { PoolBar } from "./pool-bar.js";

const SLOWED_TEXT: Record<PoolLevel, string | null> = {
  ok: null,
  warning: "Slowing down",
  critical: "Slowed down",
};

interface Props {
  usage: BudgetVmUsage;
  agents: readonly AgentView[];
}

export function CpuRow({ usage, agents }: Props) {
  const { cpu } = usage;
  const top = topCpuAgents(usage, agents);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {cpu ? (
        <PoolBar
          title="CPU"
          bar={cpuPressureBar(cpu)}
          levelText={SLOWED_TEXT}
          detail={`CPU pressure · ${Math.round(cpu.pressurePercent)}%`}
        />
      ) : (
        <span className="text-foreground">CPU</span>
      )}
      <p className="text-muted-foreground">
        {cpu?.slowed
          ? `Slowed down: your agents waited for a CPU ${Math.round(cpu.pressurePercent)}% of the last minute.${
              top.length > 0
                ? ` Using the most: ${top
                    .map(
                      (t) => `${t.agent.name} (${formatCores(t.cpuMilli)} CPU)`,
                    )
                    .join(", ")}.`
                : ""
            }`
          : "Not slowed down"}
      </p>
    </div>
  );
}
