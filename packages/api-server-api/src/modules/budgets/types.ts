export interface BudgetVmUsage {
  memory: { usedBytes: number; limitBytes: number };
  storage: { usedBytes: number; usableBytes: number };
  agents: { id: string; memoryUsedBytes: number }[];
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
