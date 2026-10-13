import type { BudgetVmUsage } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { cpuBar, topCpuAgents } from "../lib/pools.js";
import { PoolBar } from "./pool-bar.js";

interface Props {
  cpu: NonNullable<BudgetVmUsage["cpu"]>;
  usage: BudgetVmUsage;
  agents: readonly AgentView[];
}

export function CpuRow({ cpu, usage, agents }: Props) {
  const top = topCpuAgents(usage, agents).map((agent) => agent.name);
  return (
    <PoolBar
      title="CPU"
      value={cpu.congestion}
      bar={cpuBar(cpu)}
      percent={Math.round(cpu.fill * 100)}
      warning={`Your agents may be slowed down by waiting for CPU.${top.length > 0 ? ` Heaviest users: ${top.join(", ")}.` : ""}`}
    />
  );
}
