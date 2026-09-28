import type {
  AgentSpec,
  RuntimeMigration,
  RuntimeMigrationPlan,
} from "api-server-api";

import {
  effectiveMounts,
  movedStorageSize,
  planPersistedMoves,
  runtimeMigrationRefusal,
  type RuntimeMigrationContext,
} from "./runtime-migration.js";

export interface PlanInputs extends RuntimeMigrationContext {
  defaultStorageSize: string;
  retentionMs: number | null;
}

// UNIT_BOUNDARY_DESCRIPTION: what moving one agent to the new runtime would do, read without writing anything, so the user can see it before they agree. It is built from the same move plan, disk sizing and refusal the migrate request uses, so the plan and the request cannot disagree. A sleeping agent is booted once to finish the move, because only a guest that answered proves the copy, and a booted agent counts against its owner's budget.
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
  const mounts = effectiveMounts(agent.spec, inputs.defaultMounts);
  const { moves, unmovable } = planPersistedMoves(mounts);
  const asked = agent.spec.storageSize ?? inputs.defaultStorageSize;
  const resized = movedStorageSize(
    agent.spec,
    mounts,
    moves,
    inputs.defaultStorageSize,
  );
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
