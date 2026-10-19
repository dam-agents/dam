import type { BudgetsService } from "api-server-api";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { readRunnerUsage } from "./infrastructure/runner-usage.js";
import {
  readUserBudgetCeiling,
  readUserBudgetSizes,
} from "./infrastructure/user-budgets.js";
import {
  configuredPool,
  createBudgetsService,
  createResizeGate,
  createSpawnSizeGate,
  createStorageGate,
  type BudgetedAgent,
  type PoolSizes,
  type ResizeGate,
  type SpawnSizeGate,
  type StorageGate,
} from "./services/budgets-service.js";

export function composeStorageGate(deps: {
  k8s: K8sClient;
  owner: string;
  vmPool: PoolSizes;
}): StorageGate {
  return createStorageGate({
    readVmUsage: () => readRunnerUsage(deps.k8s, deps.owner),
    // UNIT_BOUNDARY_DESCRIPTION: the pool the owner's runner is created at before that runner can be read: the install's sizes, each replaced by the owner's UserBudget where it names one.
    readConfiguredPool: async () => {
      const { storage, memory } = await readUserBudgetSizes(
        deps.k8s,
        deps.owner,
      );
      return configuredPool(deps.vmPool, {
        ...(storage !== null && { storage }),
        ...(memory !== null && { memory }),
      });
    },
  });
}

export function composeBudgetsModule(deps: {
  k8s: K8sClient;
  owner: string;
  listAgents(): Promise<BudgetedAgent[]>;
  defaultCeiling: { cpu: string; memory: string };
  slotSize: { cpu: string; memory: string };
  isSlackUnlinked(): Promise<boolean>;
  vmPool: PoolSizes;
}): {
  budgets: BudgetsService;
  resizeGate: ResizeGate;
  storageGate: StorageGate;
} {
  const serviceDeps = {
    listAgents: deps.listAgents,
    readCeilingOverride: () => readUserBudgetCeiling(deps.k8s, deps.owner),
    defaultCeiling: deps.defaultCeiling,
    slotSize: deps.slotSize,
    readVmUsage: () => readRunnerUsage(deps.k8s, deps.owner),
    isSlackUnlinked: deps.isSlackUnlinked,
  };
  return {
    budgets: createBudgetsService(serviceDeps),
    resizeGate: createResizeGate(serviceDeps),
    storageGate: composeStorageGate(deps),
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
