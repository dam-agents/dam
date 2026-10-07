import type { BudgetsService } from "api-server-api";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { readUserBudgetCeiling } from "./infrastructure/user-budgets.js";
import {
  createBudgetsService,
  createResizeGate,
  createSpawnSizeGate,
  type BudgetedAgent,
  type ResizeGate,
  type SpawnSizeGate,
} from "./services/budgets-service.js";

export function composeBudgetsModule(deps: {
  k8s: K8sClient;
  owner: string;
  listAgents(): Promise<BudgetedAgent[]>;
  defaultCeiling: { cpu: string; memory: string };
  slotSize: { cpu: string; memory: string };
}): { budgets: BudgetsService; resizeGate: ResizeGate } {
  const serviceDeps = {
    listAgents: deps.listAgents,
    readCeilingOverride: () => readUserBudgetCeiling(deps.k8s, deps.owner),
    defaultCeiling: deps.defaultCeiling,
    slotSize: deps.slotSize,
  };
  return {
    budgets: createBudgetsService(serviceDeps),
    resizeGate: createResizeGate(serviceDeps),
  };
}

export function composeSpawnSizeGate(deps: {
  k8s: K8sClient;
  owner: string;
  defaultCeiling: { cpu: string; memory: string };
}): SpawnSizeGate {
  return createSpawnSizeGate({
    readCeilingOverride: () => readUserBudgetCeiling(deps.k8s, deps.owner),
    defaultCeiling: deps.defaultCeiling,
  });
}
