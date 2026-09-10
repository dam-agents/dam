import type { BudgetsService } from "api-server-api";
import type { Db } from "db";
import { createUserBudgetsReader } from "./infrastructure/user-budgets.js";
import {
  createBudgetsService,
  createResizeGate,
  createSpawnSizeGate,
  type BudgetedAgent,
  type ResizeGate,
  type SpawnSizeGate,
} from "./services/budgets-service.js";

export function composeBudgetsModule(deps: {
  db: Db;
  owner: string;
  listAgents(): Promise<BudgetedAgent[]>;
  defaultCeiling: { cpu: string; memory: string };
  slotSize: { cpu: string; memory: string };
}): { budgets: BudgetsService; resizeGate: ResizeGate } {
  const userBudgets = createUserBudgetsReader(deps.db);
  const serviceDeps = {
    listAgents: deps.listAgents,
    readCeilingOverride: () => userBudgets.ceiling(deps.owner),
    defaultCeiling: deps.defaultCeiling,
    slotSize: deps.slotSize,
  };
  return {
    budgets: createBudgetsService(serviceDeps),
    resizeGate: createResizeGate(serviceDeps),
  };
}

export function composeSpawnSizeGate(deps: {
  db: Db;
  owner: string;
  defaultCeiling: { cpu: string; memory: string };
}): SpawnSizeGate {
  const userBudgets = createUserBudgetsReader(deps.db);
  return createSpawnSizeGate({
    readCeilingOverride: () => userBudgets.ceiling(deps.owner),
    defaultCeiling: deps.defaultCeiling,
  });
}
