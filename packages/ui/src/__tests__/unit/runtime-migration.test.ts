// TEST_OVERVIEW: the agent row's runtime badge and its Migrate action. No settled
// TEST_OVERVIEW: agent is badged, and a container agent on an install that can
// TEST_OVERVIEW: virtualize is offered the migration. A migrating agent shows the
// TEST_OVERVIEW: migration in progress with its phase and the controller's reason, a
// TEST_OVERVIEW: failed one distinctly, and the way back until the agent has started on
// TEST_OVERVIEW: the new runtime. Each row's Abort and Retry stay busy exactly as long
// TEST_OVERVIEW: as that row's own request.
import { describe, expect, test } from "vitest";

import {
  type InFlightIds,
  migrateAction,
  retentionSentence,
  runtimeBadge,
  whileInFlight,
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
  // TEST_SCENARIO: the new runtime is the default and a container agent already shows its Migrate action, so a settled agent carries no badge either way.
  test("leaves a settled agent unbadged", () => {
    expect(runtimeBadge(agent({}), ON)).toBeNull();
    expect(runtimeBadge(agent({ runtimeMigratable: false }), ON)).toBeNull();
    expect(runtimeBadge(agent({ vm: true }), ON)).toBeNull();
    expect(runtimeBadge(agent({ vm: true }), OFF)).toBeNull();
  });

  // TEST_SCENARIO: before the install answer arrives the page cannot know whether a migration is running; showing one and then swapping it reads as a change to the agent.
  test("shows nothing until the install is answered", () => {
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
  // TEST_SCENARIO: a migration under way is badged with its phase, and a failed one with a badge of its own, so a stuck move is never mistaken for one still running.
  test("shows the phase, and a failure distinctly", () => {
    const copying = runtimeBadge(
      agent({ runtimeMigration: migration("copying") }),
      ON,
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
  test("offers the migration to a container agent on an install that can virtualize", () => {
    expect(migrateAction(agent({}), ON, false)).toEqual({ kind: "offer" });
  });

  test("offers nothing on an install that cannot virtualize or has not said", () => {
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

  // TEST_SCENARIO: an agent already moving shows its move and its way back whatever the install read now says, since the user started it and has something to finish or undo.
  test("keeps showing a migration whatever the install read says", () => {
    expect(
      migrateAction(
        agent({ runtimeMigration: migration("copying") }),
        OFF,
        false,
      )?.kind,
    ).toBe("migrating");
  });
});

describe("whileInFlight", () => {
  function tracker() {
    let ids: InFlightIds = new Map();
    const update = (next: (current: InFlightIds) => InFlightIds) => {
      ids = next(ids);
    };
    const deferred = () => {
      let settle: (ok: boolean) => void = () => {};
      const promise = new Promise<void>((resolve, reject) => {
        settle = (ok) => (ok ? resolve() : reject(new Error("refused")));
      });
      return { promise, settle };
    };
    return { busy: (id: string) => (ids.get(id) ?? 0) > 0, update, deferred };
  }

  // TEST_SCENARIO: aborting one row and then another keeps the first busy until its own request settles, and a failed request frees its row too; a mutation's latest variables would have released the first row as soon as the second started.
  test("keeps each row busy until its own request settles", async () => {
    const t = tracker();
    const a = t.deferred();
    const b = t.deferred();
    const runA = whileInFlight("a", t.update, () => a.promise);
    const runB = whileInFlight("b", t.update, () => b.promise);
    expect([t.busy("a"), t.busy("b")]).toEqual([true, true]);
    b.settle(true);
    await runB;
    expect([t.busy("a"), t.busy("b")]).toEqual([true, false]);
    a.settle(false);
    await runA;
    expect(t.busy("a")).toBe(false);
  });

  // TEST_SCENARIO: an abort and a retry of the same agent in flight together both have to settle before its buttons come back.
  test("counts two requests for one agent", async () => {
    const t = tracker();
    const abort = t.deferred();
    const retry = t.deferred();
    const runAbort = whileInFlight("a", t.update, () => abort.promise);
    const runRetry = whileInFlight("a", t.update, () => retry.promise);
    retry.settle(true);
    await runRetry;
    expect(t.busy("a")).toBe(true);
    abort.settle(true);
    await runAbort;
    expect(t.busy("a")).toBe(false);
  });
});

describe("the confirm dialog's plan", () => {
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
