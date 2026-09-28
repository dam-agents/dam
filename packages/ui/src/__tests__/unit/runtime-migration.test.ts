// TEST_OVERVIEW: the agent row's runtime badge and its Migrate action. With the
// TEST_OVERVIEW: vm-sandboxes experiment off, only a vm agent is badged, as the
// TEST_OVERVIEW: new runtime. With it on, a container agent is badged as the old
// TEST_OVERVIEW: runtime and offered the migration, and a migrating agent shows
// TEST_OVERVIEW: the migration in progress with its phase and the controller's
// TEST_OVERVIEW: reason, a failed one distinctly, and the way back until the
// TEST_OVERVIEW: agent has started on the new runtime.
import { describe, expect, test } from "vitest";

import {
  migrateAction,
  runtimeBadge,
} from "../../modules/agents/utils/runtime-migration.js";
import type { AgentView, RuntimeMigrationView } from "../../types.js";

const ON = { answered: true, vm: true };
const OFF = { answered: true, vm: false };
const UNANSWERED = { answered: false, vm: false };

function agent(extra: Partial<AgentView>): AgentView {
  return {
    id: "a",
    name: "a",
    vm: false,
    runtimeMigratable: true,
    runtimeMigration: null,
    ...extra,
  } as AgentView;
}

describe("runtimeBadge", () => {
  test("experiment off: badges a vm agent as the new runtime", () => {
    expect(runtimeBadge(agent({ vm: true }), OFF)?.kind).toBe("new");
    expect(runtimeBadge(agent({ vm: true }), OFF)?.label).toBe("New runtime");
  });

  test("experiment off: leaves a container agent unbadged", () => {
    expect(runtimeBadge(agent({}), OFF)).toBeNull();
  });

  // TEST_SCENARIO: with the experiment on the new runtime is the default, so badging it would badge almost every agent; the old runtime is the exception worth pointing at.
  test("experiment on: badges a container agent as the old runtime", () => {
    const badge = runtimeBadge(agent({}), ON);
    expect(badge?.kind).toBe("old");
    expect(badge?.label).toBe("Old runtime");
    expect(badge?.title).toMatch(/can be migrated/);
  });

  test("experiment on: does not promise a migration the agent cannot have", () => {
    expect(
      runtimeBadge(agent({ runtimeMigratable: false }), ON)?.title,
    ).not.toMatch(/migrated/);
  });

  test("experiment on: leaves a vm agent unbadged", () => {
    expect(runtimeBadge(agent({ vm: true }), ON)).toBeNull();
  });

  // TEST_SCENARIO: before the flag and the install answer arrive the page cannot know which badge is right; showing one and then swapping it reads as a change to the agent.
  test("shows nothing until the experiment is answered", () => {
    expect(runtimeBadge(agent({ vm: true }), UNANSWERED)).toBeNull();
    expect(runtimeBadge(agent({}), UNANSWERED)).toBeNull();
  });
});

function migration(
  phase: RuntimeMigrationView["phase"],
  extra?: Partial<RuntimeMigrationView>,
): RuntimeMigrationView {
  return {
    phase,
    abortable: phase !== "verified" && phase !== "aborting",
    retryable: phase === "failed",
    ...extra,
  };
}

describe("runtimeBadge during a migration", () => {
  // TEST_SCENARIO: a migration the user started is badged with its phase whatever the experiment says, and a failed one with a badge of its own, so a stuck move is never mistaken for one still running.
  test("shows the phase, and a failure distinctly", () => {
    const copying = runtimeBadge(
      agent({ runtimeMigration: migration("copying") }),
      OFF,
    );
    expect(copying).toMatchObject({
      kind: "migrating",
      label: "Migrating: copying",
    });
    const failed = runtimeBadge(
      agent({
        runtimeMigration: migration("failed", { message: "runner is full" }),
      }),
      ON,
    );
    expect(failed).toEqual({
      kind: "failed",
      label: "Migration failed",
      title: "runner is full",
    });
  });
});

describe("migrateAction", () => {
  test("offers the migration to a container agent when the experiment is on", () => {
    expect(migrateAction(agent({}), ON, false)).toEqual({ kind: "offer" });
  });

  test("offers nothing when the experiment is off or unanswered", () => {
    expect(migrateAction(agent({}), OFF, false)).toBeNull();
    expect(migrateAction(agent({}), UNANSWERED, false)).toBeNull();
  });

  test("offers nothing to a vm agent or one the api-server would refuse", () => {
    expect(migrateAction(agent({ vm: true }), ON, false)).toBeNull();
    expect(
      migrateAction(agent({ runtimeMigratable: false }), ON, false),
    ).toBeNull();
  });

  test("shows the request in flight while the mutation is pending", () => {
    expect(migrateAction(agent({}), ON, true)).toEqual({ kind: "requesting" });
  });

  // TEST_SCENARIO: each phase is named on the button, with the controller's reason as its tooltip, and the way back is offered until the agent has started on the new runtime.
  test("shows each phase with its reason and an Abort until verified", () => {
    expect(
      migrateAction(
        agent({
          runtimeMigration: migration("booting", { message: "runner is full" }),
        }),
        ON,
        false,
      ),
    ).toEqual({
      kind: "migrating",
      label: "Booting…",
      title: "runner is full",
      abortable: true,
    });
    expect(
      migrateAction(
        agent({ runtimeMigration: migration("copying", { attempts: 2 }) }),
        ON,
        false,
      ),
    ).toMatchObject({ title: expect.stringMatching(/attempt 2/) });
    expect(
      migrateAction(
        agent({ vm: true, runtimeMigration: migration("verified") }),
        ON,
        false,
      ),
    ).toMatchObject({ kind: "migrating", abortable: false });
  });

  // TEST_SCENARIO: a failed migration is its own state, not a spinner: it names why it failed and offers both Retry and Abort.
  test("shows a failure with Retry and Abort", () => {
    expect(
      migrateAction(
        agent({
          runtimeMigration: migration("failed", { message: "gave up" }),
        }),
        ON,
        false,
      ),
    ).toEqual({
      kind: "failed",
      title: "gave up",
      abortable: true,
      retryable: true,
    });
  });

  // TEST_SCENARIO: a user who turned the experiment off while a move was under way must still be able to see it and undo it.
  test("keeps showing a migration with the experiment off", () => {
    expect(
      migrateAction(
        agent({ runtimeMigration: migration("copying") }),
        OFF,
        false,
      )?.kind,
    ).toBe("migrating");
  });
});
