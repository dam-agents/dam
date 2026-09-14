/** UNIT_BOUNDARY_DESCRIPTION: builds a runtime-delivery outbox row for tests.
 *  Every field is required by the type but only a couple matter to any given
 *  test, so each suite used to carry its own full copy and adding a column
 *  meant editing all of them. Defaults describe an agent that is caught up;
 *  a test overrides only the fields it asserts on. */
import type { OutboxRow } from "../../modules/runtime-delivery/infrastructure/outbox-repo.js";

export function outboxRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    agentId: "agent-1",
    version: 1,
    lastEnqueuedAt: new Date(0),
    lastSettledVersion: 1,
    lastAppliedVersion: 1,
    lastAppliedHash: null,
    lastAppliedAt: null,
    applyFailures: [],
    applyAttempts: 0,
    droppedContributionKinds: [],
    ...overrides,
  };
}
