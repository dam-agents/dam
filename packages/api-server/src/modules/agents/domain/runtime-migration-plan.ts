import type {
  AgentSpec,
  RuntimeMigration,
  RuntimeMigrationPlan,
} from "api-server-api";

import {
  movedStorageSize,
  planPersistedMoves,
  runtimeMigrationRefusal,
} from "./runtime-migration.js";

const DURATION_UNITS_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  ms: 1,
  s: 1e3,
  m: 60e3,
  h: 3600e3,
};

// UNIT_BOUNDARY_DESCRIPTION: the retention window is a chart value the controller reads as a Go duration, such as 168h or 72h30m. The api-server only shows it, so it reads the same syntax into milliseconds, and anything it cannot read is null, which the plan shows as an unknown window rather than a wrong one.
export function goDurationMs(raw: string): number | null {
  const text = raw.trim();
  if (text === "0") return 0;
  const part = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/gy;
  let total = 0;
  let at = 0;
  for (const m of text.matchAll(part)) {
    total += Number(m[1]) * (DURATION_UNITS_MS[m[2] ?? ""] ?? 0);
    at = (m.index ?? 0) + m[0].length;
  }
  return at > 0 && at === text.length ? total : null;
}

export interface PlanInputs {
  virtualizationEnabled: boolean;
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
  const { moves, unmovable } = planPersistedMoves(agent.spec);
  const asked = agent.spec.storageSize ?? inputs.defaultStorageSize;
  const resized = movedStorageSize(
    agent.spec,
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
    refusal: runtimeMigrationRefusal(agent, inputs.virtualizationEnabled),
  };
}
