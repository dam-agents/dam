import type { BudgetsService, UserBudgetDefaults } from "api-server-api";
import type { Db } from "db";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import {
  deleteUserBudget as deleteStoredUserBudget,
  listUserBudgets as listStoredUserBudgets,
  readUserBudget as readStoredUserBudget,
  writeUserBudget as writeStoredUserBudget,
} from "../agent-store/user-budgets.js";
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
  agentStore?: { authority: "crd" | "postgres"; db: Db } | undefined;
}): UserBudgetsForOperator {
  const store =
    deps.agentStore?.authority === "postgres"
      ? {
          list: () => listStoredUserBudgets(deps.agentStore!.db),
          get: (ownerSub: string) =>
            readStoredUserBudget(deps.agentStore!.db, ownerSub),
          write: (input: Parameters<typeof writeStoredUserBudget>[1]) =>
            writeStoredUserBudget(deps.agentStore!.db, input),
          remove: (ownerSub: string) =>
            deleteStoredUserBudget(deps.agentStore!.db, ownerSub),
        }
      : {
          list: () => listUserBudgets(deps.k8s),
          get: (ownerSub: string) => readUserBudget(deps.k8s, ownerSub),
          write: (input: Parameters<typeof writeUserBudget>[1]) =>
            writeUserBudget(deps.k8s, input),
          remove: (ownerSub: string) => deleteUserBudget(deps.k8s, ownerSub),
        };
  return createUserBudgetsAdmin({
    store,
    users: deps.users,
    defaults: deps.defaults,
  });
}
