import type { BudgetsService, UserBudgetDefaults } from "api-server-api";
import type { Db } from "db";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { readsRows, type AgentStoreMode } from "../agent-store/fence.js";
import {
  deleteUserBudget as deleteStoredUserBudget,
  listUserBudgets as listStoredUserBudgets,
  readUserBudget as readStoredUserBudget,
  readUserBudgetSizes as readStoredUserBudgetSizes,
  writeUserBudget as writeStoredUserBudget,
} from "../agent-store/user-budgets.js";
import { parseCpuMilli } from "../../core/quantities.js";
import { readRunnerUsage } from "./infrastructure/runner-usage.js";
import {
  deleteUserBudget,
  listUserBudgets,
  readUserBudget,
  readUserBudgetSizes,
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

// UNIT_BOUNDARY_DESCRIPTION: what the home dashboard shows CPU use against: the owner's CPU pool, from the same budget record the operator writes, else the install's default, and the vCPUs every machine gets.
export interface CpuPoolSettings {
  defaultCpu: string;
  machineCpus: number;
  agentStore: { authority: AgentStoreMode; db: Db };
}

export function composeBudgetsModule(deps: {
  k8s: K8sClient;
  owner: string;
  cpuPool: CpuPoolSettings;
  listAgentIds(): Promise<string[]>;
  isSlackUnlinked(): Promise<boolean>;
}): {
  budgets: BudgetsService;
  storageGate: StorageGate;
} {
  const { defaultCpu, machineCpus, agentStore } = deps.cpuPool;
  return {
    budgets: createBudgetsService({
      listAgentIds: deps.listAgentIds,
      readVmUsage: () => readRunnerUsage(deps.k8s, deps.owner),
      readCpuPoolMilli: async () => {
        const { cpu } = readsRows(agentStore.authority)
          ? await readStoredUserBudgetSizes(agentStore.db, deps.owner)
          : await readUserBudgetSizes(deps.k8s, deps.owner);
        return parseCpuMilli(cpu ?? defaultCpu);
      },
      machineMilli: machineCpus > 0 ? machineCpus * 1000 : null,
      isSlackUnlinked: deps.isSlackUnlinked,
    }),
    storageGate: composeStorageGate(deps),
  };
}

export function composeUserBudgetsAdmin(deps: {
  k8s: K8sClient;
  users: BudgetUsers;
  defaults: UserBudgetDefaults;
  agentStore?: { authority: AgentStoreMode; db: Db } | undefined;
}): UserBudgetsForOperator {
  const store =
    deps.agentStore !== undefined && readsRows(deps.agentStore.authority)
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
