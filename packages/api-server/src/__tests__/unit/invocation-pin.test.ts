import { describe, expect, test } from "vitest";

import { createInvocationPinReconciler } from "../../modules/invocations/services/invocation-pin.js";

// TEST_OVERVIEW: the Invocation Pin keeps a Driver awake while it has a running Invocation. A spawn sets it; each reconcile releases the pin of every pinned Driver that no longer has a running Invocation, reading the Driver before it checks and releasing only that version, and never sets one, so a pause or stop that cleared a pin stays in force.

function makeReconciler(opts: {
  pinned: string[];
  running: string[];
  failRelease?: string;
  unpinnedOnRead?: string[];
}) {
  const released: string[] = [];
  const checked: string[] = [];
  const steps: string[] = [];
  const reconciler = createInvocationPinReconciler({
    listPinnedAgentIds: async () => opts.pinned,
    readPin: async (id) => {
      steps.push(`read:${id}`);
      return opts.unpinnedOnRead?.includes(id) ? null : `v-${id}`;
    },
    hasRunningInvocation: async (id) => {
      checked.push(id);
      steps.push(`check:${id}`);
      return opts.running.includes(id);
    },
    release: async (id, version) => {
      if (id === opts.failRelease) throw new Error("gone");
      steps.push(`release:${id}@${version}`);
      released.push(id);
    },
  });
  return { reconciler, released, checked, steps };
}

describe("the Invocation Pin reconciler", () => {
  // TEST_SCENARIO: whichever path ended the Driver's last Invocation — a result, a failed setup, a deadline — the next tick releases its pin.
  test("releases a Driver whose Invocations have all ended", async () => {
    const { reconciler, released } = makeReconciler({
      pinned: ["driver-1", "driver-2"],
      running: ["driver-2"],
    });

    expect(await reconciler.tick()).toEqual({ released: 1 });
    expect(released).toEqual(["driver-1"]);
  });

  // TEST_SCENARIO: a spawn that lands between listing the pinned Drivers and releasing one must keep its pin, so each Driver is checked for a running Invocation right before its release.
  test("checks each Driver just before releasing it", async () => {
    const { reconciler, checked } = makeReconciler({
      pinned: ["driver-1", "driver-2"],
      running: [],
    });

    await reconciler.tick();

    expect(checked).toEqual(["driver-1", "driver-2"]);
  });

  // TEST_SCENARIO: a spawn landing after the check sets the pin and so changes the Driver; the release carries the version read before the check, so that spawn's write makes the release fail instead of losing the pin.
  test("reads the Driver before the check and releases only that version", async () => {
    const { reconciler, steps } = makeReconciler({
      pinned: ["driver-1"],
      running: [],
    });

    await reconciler.tick();

    expect(steps).toEqual([
      "read:driver-1",
      "check:driver-1",
      "release:driver-1@v-driver-1",
    ]);
  });

  // TEST_SCENARIO: the listing comes from a cache; a Driver whose pin a pause already cleared is left alone, stale clock and all.
  test("skips a Driver found unpinned on the read", async () => {
    const { reconciler, released, checked } = makeReconciler({
      pinned: ["driver-1"],
      running: [],
      unpinnedOnRead: ["driver-1"],
    });

    expect(await reconciler.tick()).toEqual({ released: 0 });
    expect(released).toEqual([]);
    expect(checked).toEqual([]);
  });

  // TEST_SCENARIO: a pause or stop clears the pin while sub-agents still run; the reconciler only ever releases, so it cannot pin that Driver again and wake it.
  test("never pins a Driver it did not find pinned", async () => {
    const { reconciler, released, checked } = makeReconciler({
      pinned: [],
      running: ["paused-driver"],
    });

    expect(await reconciler.tick()).toEqual({ released: 0 });
    expect(released).toEqual([]);
    expect(checked).toEqual([]);
  });

  // TEST_SCENARIO: a pin that cannot be released for one Driver (it was deleted meanwhile) must not stop the others from being released.
  test("one failed release does not stop the rest", async () => {
    const { reconciler, released } = makeReconciler({
      pinned: ["gone-driver", "driver-1"],
      running: [],
      failRelease: "gone-driver",
    });

    expect(await reconciler.tick()).toEqual({ released: 1 });
    expect(released).toEqual(["driver-1"]);
  });
});
