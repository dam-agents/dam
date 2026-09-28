// TEST_OVERVIEW: the agent row's runtime badge and its Migrate action. With the
// TEST_OVERVIEW: vm-sandboxes experiment off, only a vm agent is badged, as the
// TEST_OVERVIEW: new runtime. With it on, a container agent is badged as the old
// TEST_OVERVIEW: runtime and offered the migration, and a migrating agent shows
// TEST_OVERVIEW: the migration in progress with the controller's reason.
import { describe, expect, test } from "vitest";

import {
  migrateAction,
  planMoveLines,
  retentionSentence,
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

  test("offers nothing to a vm agent", () => {
    expect(migrateAction(agent({ vm: true }), ON, false)).toBeNull();
  });

  // TEST_SCENARIO: a container agent the api-server would refuse used to lose its button with no word why; it keeps a disabled one whose hover lists the reasons.
  test("shows a refused action for a container agent the api-server would refuse", () => {
    expect(
      migrateAction(agent({ runtimeMigratable: false }), ON, false),
    ).toEqual({ kind: "refused" });
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

describe("the confirm dialog's plan", () => {
  // TEST_SCENARIO: a path outside the home moves below it; the dialog names where it will live, in the ~ form the agent's shell shows, and a path already under the home is said to stay.
  test("names where each moved path will live", () => {
    expect(
      planMoveLines({
        moves: [
          { from: "/data", to: "/home/agent/.persisted/data" },
          { from: "/home/agent/cache", to: "/home/agent/cache" },
        ],
      }),
    ).toEqual([
      { from: "/data", to: "~/.persisted/data", stays: false },
      { from: "/home/agent/cache", to: "~/cache", stays: true },
    ]);
  });

  test("says a whole number of days in days", () => {
    expect(retentionSentence(7 * 24 * 3600_000)).toMatch(/kept for 7 days /);
    expect(retentionSentence(24 * 3600_000)).toMatch(/kept for 1 day /);
  });

  test("says a window that is not whole days in hours", () => {
    expect(retentionSentence(36 * 3600_000)).toMatch(/kept for 36 hours /);
    expect(retentionSentence(3600_000)).toMatch(/kept for 1 hour /);
  });

  // TEST_SCENARIO: a window under an hour used to round down to "0 hours", which reads as not kept; it is said in minutes instead.
  test("says a window under an hour in minutes", () => {
    expect(retentionSentence(30 * 60_000)).toMatch(/kept for 30 minutes /);
    expect(retentionSentence(90 * 60_000)).toMatch(/kept for 90 minutes /);
    expect(retentionSentence(60_000)).toMatch(/kept for 1 minute /);
  });

  test("says a window under a minute in seconds", () => {
    expect(retentionSentence(45_000)).toMatch(/kept for 45 seconds /);
    expect(retentionSentence(1500)).toMatch(/kept for 2 seconds /);
  });

  // TEST_SCENARIO: an install that sets the window to zero deletes the old volumes once the move is done; the dialog must not promise they are kept.
  test("says a zero window keeps nothing", () => {
    expect(retentionSentence(0)).toBe(
      "The old volumes are not kept: they are deleted once the move has finished.",
    );
  });

  // TEST_SCENARIO: null is the one case the api-server could not read the window; the dialog says the volumes are kept without naming a length it does not know.
  test("names no length for a window the api-server could not read", () => {
    expect(retentionSentence(null)).toBe(
      "The old volumes are kept for a while after the move, so an admin can recover anything missing.",
    );
  });
});
