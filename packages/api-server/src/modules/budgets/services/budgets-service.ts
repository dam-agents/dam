import type { BudgetReserved, BudgetsService } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { parseMemoryBytes } from "../../../core/quantities.js";
import {
  storageRefusal,
  vmUsageView,
  type RunnerUsage,
} from "../domain/vm-usage.js";

interface BudgetsServiceDeps {
  listAgentIds(): Promise<string[]>;
  readVmUsage(): Promise<RunnerUsage | null>;
  isSlackUnlinked(): Promise<boolean>;
}

export interface StorageGate {
  assertCanCreateVm(): Promise<void>;
}

export function createStorageGate(deps: {
  readVmUsage(): Promise<RunnerUsage | null>;
}): StorageGate {
  return {
    async assertCanCreateVm() {
      const refusal = storageRefusal(await deps.readVmUsage());
      if (refusal) throw refusal;
    },
  };
}

export function createBudgetsService(deps: BudgetsServiceDeps): BudgetsService {
  return {
    async reserved(): Promise<BudgetReserved> {
      const [agentIds, vmUsage] = await Promise.all([
        deps.listAgentIds(),
        deps.readVmUsage(),
      ]);
      if (!vmUsage) return {};
      const slackUnlinked = await deps
        .isSlackUnlinked()
        .catch((error: unknown) => {
          getLogger().warn({ error }, "budgets.slack-link.failed");
          return false;
        });
      return {
        vm: {
          ...vmUsageView(vmUsage, new Set(agentIds)),
          ...(slackUnlinked ? { slackUnlinked } : {}),
        },
      };
    },
  };
}
