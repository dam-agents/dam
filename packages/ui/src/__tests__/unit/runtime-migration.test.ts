// TEST_OVERVIEW: the runtime badges an agent row shows while someone moves the
// TEST_OVERVIEW: agent to the new runtime. The move is started outside the app,
// TEST_OVERVIEW: so the badge is the only thing the page says about it: the
// TEST_OVERVIEW: phase in progress with the controller's reason as its tooltip,
// TEST_OVERVIEW: and a failure distinctly. A settled agent carries no badge.
import { describe, expect, test } from "vitest";

import { runtimeMigrationBadge } from "../../modules/agents/utils/runtime-migration.js";
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

describe("runtimeMigrationBadge", () => {
  // TEST_SCENARIO: an agent with no migration under way is badged for nothing, on either runtime: a container agent is one nobody has come to move yet.
  test("leaves a settled agent unbadged", () => {
    expect(runtimeMigrationBadge(agent({}))).toBeNull();
    expect(runtimeMigrationBadge(agent({ vm: true }))).toBeNull();
  });

  // TEST_SCENARIO: a migration under way is badged with its phase, and a failed one with a badge of its own, so a stuck move is never mistaken for one still running.
  test("shows the phase, and a failure distinctly", () => {
    expect(
      runtimeMigrationBadge(agent({ runtimeMigration: migration("copying") })),
    ).toMatchObject({ kind: "migrating", label: "Migrating: copying" });
    expect(
      runtimeMigrationBadge(
        agent({
          runtimeMigration: migration("failed", { message: "runner is full" }),
        }),
      ),
    ).toEqual({
      kind: "failed",
      label: "Migration failed",
      title: "runner is full",
    });
  });

  // TEST_SCENARIO: each phase reads as what is happening to the agent, and one retried copy names its attempt.
  test("names every phase, and a retried copy names its attempt", () => {
    const label = (phase: RuntimeMigrationView["phase"]) =>
      runtimeMigrationBadge(agent({ runtimeMigration: migration(phase) }))
        ?.label;
    expect(label("requested")).toBe("Migrating: preparing");
    expect(label("stopping")).toBe("Migrating: stopping");
    expect(label("booting")).toBe("Migrating: booting");
    expect(label("verified")).toBe("Migrating: finishing");
    expect(label("aborting")).toBe("Migrating: undoing");
    expect(
      runtimeMigrationBadge(
        agent({ runtimeMigration: migration("copying", { attempts: 2 }) }),
      )?.title,
    ).toMatch(/attempt 2/);
  });
});
