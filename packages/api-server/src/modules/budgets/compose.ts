import type { BudgetsService } from "api-server-api";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { createUserBudgetsReader } from "./infrastructure/user-budgets.js";
import {
  createBudgetsService,
  createResizeGate,
  type BudgetedAgent,
  type ResizeGate,
} from "./services/budgets-service.js";

export function composeBudgetsModule(deps: {
  k8s: K8sClient;
  owner: string;
  listAgents(): Promise<BudgetedAgent[]>;
  defaultCeiling: { cpu: string; memory: string };
}): { budgets: BudgetsService; resizeGate: ResizeGate } {
  const userBudgets = createUserBudgetsReader(deps.k8s);
  const serviceDeps = {
    listAgents: deps.listAgents,
    readCeilingOverride: () => userBudgets.ceiling(deps.owner),
    defaultCeiling: deps.defaultCeiling,
  };
  return {
    budgets: createBudgetsService(serviceDeps),
    resizeGate: createResizeGate(serviceDeps),
  };
}
