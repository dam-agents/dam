import type {
  AgentSpec,
  RuntimeMigration,
  RuntimeMigrationPlan,
} from "api-server-api";

import {
  effectiveMounts,
  planPersistedMoves,
  runtimeMigrationRefusal,
  runtimeMigrationRequest,
  type RuntimeMigrationContext,
} from "./runtime-migration.js";

export interface PlanInputs extends RuntimeMigrationContext {
  defaultStorageSize: string;
  retentionMs: number | null;
}

// UNIT_BOUNDARY_DESCRIPTION: what moving one agent to the new runtime would do, read without writing anything, so the user can see it before they agree. It is read off the very request a migrate would record — its moves and the target disk size — and the same refusal the request checks, so the plan and the request cannot disagree. The unmovable paths come from the same move rule. A sleeping agent is booted once to finish the move, because only a guest that answered proves the copy, and a booted agent counts against its owner's budget.
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
  const { target, moves } = runtimeMigrationRequest(
    agent.spec,
    inputs.defaultStorageSize,
    inputs.defaultMounts,
  );
  const { unmovable } = planPersistedMoves(
    effectiveMounts(agent.spec, inputs.defaultMounts),
  );
  const asked = agent.spec.storageSize ?? inputs.defaultStorageSize;
  const resized = target.storageSize;
  return {
    moves: Object.entries(moves).map(([from, to]) => ({ from, to })),
    unmovable,
    storageSize: resized ?? asked,
    storageResized: resized !== undefined && resized !== asked,
    bootsSleepingAgent: agent.hibernated || agent.stopRequested,
    retentionMs: inputs.retentionMs,
    refusal: runtimeMigrationRefusal(agent, inputs),
  };
}
