export type PoolLevel = "ok" | "warning" | "critical";
export type CpuCongestion = "low" | "moderate" | "high" | "severe";

// UNIT_BOUNDARY_DESCRIPTION: what the caller's vm agents use of their pools, read from their runner on demand. A level is "warning" from 75% of a pool and "critical" from 90%. `cpu` is absent when the runner reports neither a CPU limit nor a CPU pressure; its pressure is the share of the last minute the agents waited for a CPU, shown as a congestion word and a 0–1 fill of the bar. An agent's storage is the blocks its disk takes, and its CPU the average over the runner's last probe of it; either is 0 when unmeasured. `slackUnlinked` is true when the install has Slack and the caller has not linked their Slack account, so they would get no alert there.
export interface BudgetVmUsage {
  memory: { usedBytes: number; limitBytes: number; level: PoolLevel };
  storage: { usedBytes: number; usableBytes: number; level: PoolLevel };
  cpu?: {
    limitMilli: number;
    usedMilli: number;
    throttledPercent: number;
    pressurePercent: number;
    congestion: CpuCongestion;
    level: PoolLevel;
    fill: number;
  };
  agents: {
    id: string;
    memoryUsedBytes: number;
    storageUsedBytes: number;
    cpuMilli: number;
  }[];
  observedAt: string;
  slackUnlinked?: boolean;
}

export interface BudgetStorageFull {
  usedBytes: number;
  usableBytes: number;
  percent: number;
}

export interface BudgetReserved {
  cpu: { reservedMilli: number; ceilingMilli: number };
  memory: { reservedBytes: number; ceilingBytes: number };
  slot: { cpuMilli: number; memoryBytes: number };
  vm?: BudgetVmUsage;
}

export interface BudgetsService {
  reserved(): Promise<BudgetReserved>;
}
