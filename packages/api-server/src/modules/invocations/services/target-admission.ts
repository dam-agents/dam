import type { Resources } from "api-server-api";
import {
  concreteResources,
  type DefaultResourceLimits,
} from "../../agents/index.js";
import type { SpawnSizeGate } from "../../budgets/index.js";

// UNIT_BOUNDARY_DESCRIPTION: Fail-fast admission for invocation targets. A spawn whose effective Size exceeds the owner's budget Ceiling in either dimension can never be admitted by the controller's 0→1 gate — it would park OverBudget until the invocation deadline reaps it hours later. This unit resolves the Size the create would stamp (explicit size wins, else template limits, else the chart default) and rejects a never-fits spawn at the spawn route instead. A spawn that fits the Ceiling but not the room currently free is deliberately NOT rejected here: a sweepable target parks and auto-starts when room frees — the queue-not-fail path.

export interface TargetAdmission {
  assertCanEverFit(input: {
    templateId?: string;
    size?: { cpu?: string; memory?: string };
  }): Promise<void>;
}

export function createTargetAdmission(deps: {
  readTemplateResources: (templateId: string) => Promise<Resources | undefined>;
  defaultLimits: DefaultResourceLimits;
  gate: SpawnSizeGate;
}): TargetAdmission {
  return {
    async assertCanEverFit(input) {
      const templateResources = input.templateId
        ? await deps.readTemplateResources(input.templateId)
        : undefined;
      const { limits } = concreteResources(
        templateResources,
        input.size,
        deps.defaultLimits,
      );
      await deps.gate.assertCanEverFit(limits);
    },
  };
}
