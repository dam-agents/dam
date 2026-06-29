import type { Db } from "db";
import { parseAmount } from "./domain/resources.js";
import { createUserBudgetsRepository } from "./infrastructure/user-budgets-repository.js";
import {
  createBudgetGuard,
  type BudgetGuard,
  type RunningAgentsPort,
} from "./services/budget-guard.js";

export function composeBudgetsModule(deps: {
  db: Db;
  running: RunningAgentsPort;
  agentDefaultRequests: { cpu: string; memory: string };
  defaultCeiling: { cpu: string; memory: string };
}): { budget: BudgetGuard } {
  return {
    budget: createBudgetGuard({
      running: deps.running,
      budgets: createUserBudgetsRepository(deps.db),
      agentDefault: parseAmount(
        deps.agentDefaultRequests.cpu,
        deps.agentDefaultRequests.memory,
      ),
      defaultCeiling: parseAmount(
        deps.defaultCeiling.cpu,
        deps.defaultCeiling.memory,
      ),
    }),
  };
}
