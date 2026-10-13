import type {
  AgentSpec,
  RuntimeMigration,
  RuntimeMigrationPlan,
} from "api-server-api";

import {
  effectiveMounts,
  runtimeMigrationRefusal,
  unmovablePaths,
  type RuntimeMigrationContext,
} from "./runtime-migration.js";

export interface PlanInputs extends RuntimeMigrationContext {
  retentionMs: number | null;
}

// UNIT_BOUNDARY_DESCRIPTION: what moving one agent to the new runtime would do, read without writing anything, so the user can see it before they agree. It is read off the same refusal the request checks, so the plan and the request cannot disagree. It names no disk size: the agent's disk on the new runtime grows inside its owner's storage pool. The unmovable paths come from the same rule the refusal applies. A sleeping agent is booted once to finish the move, because only a guest that answered proves the copy, and a booted agent counts against its owner's budget.
export function runtimeMigrationPlan(
  agent: {
    spec: AgentSpec;
    runtimeMigration?: RuntimeMigration;
    storageMigrating?: boolean;
    hibernated: boolean;
    stopRequested: boolean;
  },
  inputs: PlanInputs,
): RuntimeMigrationPlan {
  const unmovable = unmovablePaths(
    effectiveMounts(agent.spec, inputs.defaultMounts),
  );
  return {
    unmovable,
    bootsSleepingAgent: agent.hibernated || agent.stopRequested,
    retentionMs: inputs.retentionMs,
    refusal: runtimeMigrationRefusal(agent, inputs),
  };
}
