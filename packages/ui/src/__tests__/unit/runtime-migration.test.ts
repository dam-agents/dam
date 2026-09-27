// TEST_OVERVIEW: the agent row's runtime badge and its Migrate action. With the
// TEST_OVERVIEW: vm-sandboxes experiment off, only a vm agent is badged, as the
// TEST_OVERVIEW: new runtime. With it on, a container agent is badged as the old
// TEST_OVERVIEW: runtime and offered the migration, and a migrating agent shows
// TEST_OVERVIEW: the migration in progress with the controller's reason.
import { describe, expect, test } from "vitest";

import {
  migrateAction,
  runtimeBadge,
} from "../../modules/agents/utils/runtime-migration.js";
import type { AgentView } from "../../types.js";

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
    expect(migrateAction(agent({}), ON, true)).toEqual({ kind: "migrating" });
  });

  // TEST_SCENARIO: the api-server sets the vm backend in the same write that requests the migration, so a migrating agent already reads as a vm agent; it must still show as migrating, not lose its button.
  test("keeps showing a running migration on an agent already switched to vm", () => {
    expect(
      migrateAction(
        agent({ vm: true, runtimeMigration: { phase: "copying" } }),
        ON,
        false,
      ),
    ).toEqual({ kind: "migrating" });
  });

  test("carries the controller's reason while a migration is retrying", () => {
    expect(
      migrateAction(
        agent({
          vm: true,
          runtimeMigration: { phase: "booting", message: "runner is full" },
        }),
        ON,
        false,
      ),
    ).toEqual({ kind: "migrating", message: "runner is full" });
  });
});
