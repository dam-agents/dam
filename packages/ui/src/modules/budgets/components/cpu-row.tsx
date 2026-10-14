import type { BudgetVmUsage, CpuCongestion } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { cpuBar, topCpuAgents } from "../lib/pools.js";
import { RESOURCE_ICON } from "../lib/resource-icons.js";
import { PoolBar } from "./pool-bar.js";

const WORD: Record<CpuCongestion, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
};

interface Props {
  cpu: NonNullable<BudgetVmUsage["cpu"]>;
  usage: BudgetVmUsage;
  agents: readonly AgentView[];
}

export function CpuRow({ cpu, usage, agents }: Props) {
  const top = topCpuAgents(usage, agents).map((agent) => agent.name);
  const word = WORD[cpu.congestion];
  return (
    <PoolBar
      title="CPU"
      icon={RESOURCE_ICON.cpu}
      value={word}
      bar={cpuBar(cpu)}
      valueText={`${word} congestion`}
      warning={`Your agents may be slowed down by waiting for CPU.${top.length > 0 ? ` Heaviest users: ${top.join(", ")}.` : ""}`}
    />
  );
}
