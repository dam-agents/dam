import type { BudgetVmUsage, CpuCongestion } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { formatCores } from "../lib/format.js";
import {
  agentsAtCpuCeiling,
  cpuBar,
  cpuPoolMilli,
  topCpuAgents,
} from "../lib/pools.js";
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

const names = (agents: readonly AgentView[]) =>
  agents.map((agent) => agent.name).join(", ");

// UNIT_BOUNDARY_DESCRIPTION: the CPU row reads as how much of the owner's CPU pool their agents use, like memory; congestion — how long the agents waited for a CPU — stays the row's level and its warning, and the warning also names an agent at its own machine's vCPUs, which is slow however empty the pool is.
export function CpuRow({ cpu, usage, agents }: Props) {
  const top = topCpuAgents(usage, agents);
  const atCeiling = agentsAtCpuCeiling(usage, agents);
  const word = WORD[cpu.congestion];
  const poolMilli = cpuPoolMilli(cpu);
  const value =
    poolMilli > 0
      ? `${formatCores(cpu.usedMilli)} of ${formatCores(poolMilli)} CPU`
      : word;
  const warning = [
    cpu.level !== "ok" &&
      `${word} congestion: your agents may be slowed down by waiting for CPU.${top.length > 0 ? ` Heaviest users: ${names(top)}.` : ""}`,
    atCeiling.length > 0 &&
      `${names(atCeiling)} ${atCeiling.length === 1 ? "is" : "are"} using all the CPU one agent can get, so ${atCeiling.length === 1 ? "it" : "they"} may be slow.`,
  ]
    .filter(Boolean)
    .join(" ");
  const bar = cpuBar(cpu, usage, agents);
  return (
    <PoolBar
      title="CPU"
      icon={RESOURCE_ICON.cpu}
      value={value}
      bar={
        atCeiling.length > 0 && bar.level === "ok"
          ? { ...bar, level: "warning" }
          : bar
      }
      valueText={
        poolMilli > 0 ? `${value}, ${word} congestion` : `${word} congestion`
      }
      percent={
        poolMilli > 0
          ? Math.min(100, Math.floor((cpu.usedMilli * 100) / poolMilli))
          : undefined
      }
      warning={warning}
    />
  );
}
