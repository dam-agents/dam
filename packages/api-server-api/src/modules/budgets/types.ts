export type PoolLevel = "ok" | "warning" | "critical";

// UNIT_BOUNDARY_DESCRIPTION: what the caller's vm agents use of their pools, read from their runner on demand. A level is "warning" from 75% of a pool and "critical" from 90%. `cpu` is absent when the runner has no CPU limit to be held back by. An agent's storage is the blocks its disk takes, and its CPU the average over the runner's last probe of it; either is 0 when unmeasured.
export interface BudgetVmUsage {
  memory: { usedBytes: number; limitBytes: number; level: PoolLevel };
  storage: { usedBytes: number; usableBytes: number; level: PoolLevel };
  cpu?: {
    limitMilli: number;
    usedMilli: number;
    throttledPercent: number;
    slowed: boolean;
  };
  agents: {
    id: string;
    memoryUsedBytes: number;
    storageUsedBytes: number;
    cpuMilli: number;
  }[];
  observedAt: string;
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
