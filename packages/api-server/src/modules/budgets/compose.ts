import type { BudgetsService, UserBudgetDefaults } from "api-server-api";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { readRunnerUsage } from "./infrastructure/runner-usage.js";
import {
  deleteUserBudget,
  listUserBudgets,
  readUserBudget,
  writeUserBudget,
} from "./infrastructure/user-budgets.js";
import {
  createBudgetsService,
  createStorageGate,
  type StorageGate,
} from "./services/budgets-service.js";
import {
  createUserBudgetsAdmin,
  type BudgetUsers,
  type UserBudgetsForOperator,
} from "./services/user-budgets-admin.js";

export function composeStorageGate(deps: {
  k8s: K8sClient;
  owner: string;
}): StorageGate {
  return createStorageGate({
    readVmUsage: () => readRunnerUsage(deps.k8s, deps.owner),
  });
}

export function composeBudgetsModule(deps: {
  k8s: K8sClient;
  owner: string;
  listAgentIds(): Promise<string[]>;
  isSlackUnlinked(): Promise<boolean>;
}): {
  budgets: BudgetsService;
  storageGate: StorageGate;
} {
  return {
    budgets: createBudgetsService({
      listAgentIds: deps.listAgentIds,
      readVmUsage: () => readRunnerUsage(deps.k8s, deps.owner),
      isSlackUnlinked: deps.isSlackUnlinked,
    }),
    storageGate: composeStorageGate(deps),
  };
}

export function composeUserBudgetsAdmin(deps: {
  k8s: K8sClient;
  users: BudgetUsers;
  defaults: UserBudgetDefaults;
}): UserBudgetsForOperator {
  return createUserBudgetsAdmin({
    store: {
      list: () => listUserBudgets(deps.k8s),
      get: (ownerSub) => readUserBudget(deps.k8s, ownerSub),
      write: (input) => writeUserBudget(deps.k8s, input),
      remove: (ownerSub) => deleteUserBudget(deps.k8s, ownerSub),
    },
    users: deps.users,
    defaults: deps.defaults,
  });
}
