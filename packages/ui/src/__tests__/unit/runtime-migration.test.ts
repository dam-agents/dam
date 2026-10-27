// TEST_OVERVIEW: the agent row's and the chat header's runtime badge: a
// TEST_OVERVIEW: migration under way shows its phase and the controller's
// TEST_OVERVIEW: reason, and a failed one a badge of its own.
import { describe, expect, test } from "vitest";

import { runtimeBadge } from "../../modules/agents/utils/runtime-migration.js";
import type { AgentView, RuntimeMigrationView } from "../../types.js";

function agent(extra: Partial<AgentView>): AgentView {
  return {
    id: "a",
    name: "a",
    vm: false,
    runtimeMigration: null,
    ...extra,
  } as AgentView;
}

function migration(
  phase: RuntimeMigrationView["phase"],
  extra?: Partial<RuntimeMigrationView>,
): RuntimeMigrationView {
  return { phase, ...extra };
}

describe("runtimeBadge during a migration", () => {
  // TEST_SCENARIO: a migration under way is badged with its phase, and a failed one with a badge of its own, so a stuck move is never mistaken for one still running.
  test("shows the phase, and a failure distinctly", () => {
    const copying = runtimeBadge(
      agent({ runtimeMigration: migration("copying") }),
    );
    expect(copying).toMatchObject({
      kind: "migrating",
      label: "Migrating: copying",
    });
    const failed = runtimeBadge(
      agent({
        runtimeMigration: migration("failed", { message: "runner is full" }),
      }),
    );
    expect(failed).toEqual({
      kind: "failed",
      label: "Migration failed",
      title: "runner is full",
    });
  });

  test("names an attempt after the first", () => {
    expect(
      runtimeBadge(
        agent({ runtimeMigration: migration("copying", { attempts: 2 }) }),
      )?.title,
    ).toMatch(/attempt 2/);
  });
});
