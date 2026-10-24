import type { z } from "zod";
import type {
  userBudgetRemoveInputSchema,
  userBudgetSetInputSchema,
  userBudgetsListInputSchema,
  userBudgetsSortSchema,
  userBudgetUserSchema,
} from "./schemas.js";

export type PoolLevel = "ok" | "warning" | "critical";
export type CpuCongestion = "low" | "moderate" | "high" | "severe";

// UNIT_BOUNDARY_DESCRIPTION: what the caller's vm agents use of their pools, read from their runner on demand. A level is "warning" from 75% of a pool and "critical" from 90%. `cpu` is absent when the runner reports neither a CPU limit nor a CPU pressure; its pressure is the share of the last minute the agents waited for a CPU, shown as a congestion word and a 0–1 fill of the bar. An agent's storage is the blocks its disk takes, and storage's `seedBytes` the blocks the disk copies a machine still holds take of the same storage; its CPU the average over the runner's last probe of it; either is 0 when unmeasured. `slackUnlinked` is true when the install has Slack and the caller has not linked their Slack account, so they would get no alert there.
export interface BudgetVmUsage {
  memory: { usedBytes: number; limitBytes: number; level: PoolLevel };
  storage: {
    usedBytes: number;
    usableBytes: number;
    seedBytes: number;
    level: PoolLevel;
  };
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
    homeFull?: boolean;
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
  vm?: BudgetVmUsage;
}

export interface BudgetsService {
  reserved(): Promise<BudgetReserved>;
}

export type UserBudgetsSort = z.infer<typeof userBudgetsSortSchema>;
export type UserBudgetsListInput = z.input<typeof userBudgetsListInputSchema>;
export type UserBudgetUser = z.infer<typeof userBudgetUserSchema>;
export type UserBudgetSetInput = z.infer<typeof userBudgetSetInputSchema>;
export type UserBudgetRemoveInput = z.infer<typeof userBudgetRemoveInputSchema>;

// UNIT_BOUNDARY_DESCRIPTION: what a user without a budget of their own gets.
export interface UserBudgetDefaults {
  cpu: string;
  memory: string;
  storage: string | null;
}

// UNIT_BOUNDARY_DESCRIPTION: one user's own budget as an operator sees it. A field the budget leaves out is null and falls back to the default on its own. `setBySub` and `updatedAt` are null for a budget written outside the platform, which records neither.
export interface UserBudgetEntry {
  ownerSub: string;
  email: string | null;
  cpu: string | null;
  memory: string | null;
  storage: string | null;
  setBySub: string | null;
  setByEmail: string | null;
  updatedAt: string | null;
}

// UNIT_BOUNDARY_DESCRIPTION: one page of the users' own budgets. `total` counts every budget, `matched` the ones the query finds, and `entries` holds at most the asked limit of those, from the asked offset on.
export interface UserBudgetPage {
  defaults: UserBudgetDefaults;
  total: number;
  matched: number;
  offset: number;
  entries: UserBudgetEntry[];
}

export interface UserBudgetsService {
  list(
    input: z.output<typeof userBudgetsListInputSchema>,
  ): Promise<UserBudgetPage>;
  set(input: UserBudgetSetInput): Promise<UserBudgetEntry | null>;
  remove(input: UserBudgetRemoveInput): Promise<{ removed: boolean }>;
}
