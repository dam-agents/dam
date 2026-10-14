import type { BudgetsService } from "api-server-api";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { readRunnerUsage } from "./infrastructure/runner-usage.js";
import { readUserBudgetCeiling } from "./infrastructure/user-budgets.js";
import {
  createBudgetsService,
  createResizeGate,
  createSpawnSizeGate,
  createStorageGate,
  type BudgetedAgent,
  type ResizeGate,
  type SpawnSizeGate,
  type StorageGate,
} from "./services/budgets-service.js";

export function composeBudgetsModule(deps: {
  k8s: K8sClient;
  owner: string;
  listAgents(): Promise<BudgetedAgent[]>;
  defaultCeiling: { cpu: string; memory: string };
  slotSize: { cpu: string; memory: string };
  isSlackUnlinked?(): Promise<boolean>;
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
    storageGate: createStorageGate(serviceDeps),
  };
}

export function composeStorageGate(deps: {
  k8s: K8sClient;
  owner: string;
}): StorageGate {
  return createStorageGate({
    readVmUsage: () => readRunnerUsage(deps.k8s, deps.owner),
  });
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
