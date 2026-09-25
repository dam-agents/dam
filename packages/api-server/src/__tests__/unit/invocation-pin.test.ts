import { describe, expect, test } from "vitest";

import { createInvocationPinReconciler } from "../../modules/invocations/services/invocation-pin.js";

// TEST_OVERVIEW: the Invocation Pin keeps a Driver awake while it has a running Invocation. Each reconcile pins exactly the Drivers with a running Invocation and releases every other pinned agent, so no terminal path has to remember to release it.

function makeReconciler(opts: {
  running: string[];
  pinned: string[];
  failSet?: string;
}) {
  const set: string[] = [];
  const released: string[] = [];
  const logs: string[] = [];
  const reconciler = createInvocationPinReconciler({
    listRunningDriverIds: async () => opts.running,
    listPinnedAgentIds: async () => opts.pinned,
    pin: {
      set: async (id) => {
        if (id === opts.failSet) throw new Error("gone");
        set.push(id);
      },
      release: async (id) => {
        released.push(id);
      },
    },
    log: (msg) => logs.push(msg),
  });
  return { reconciler, set, released, logs };
}

describe("the Invocation Pin reconciler", () => {
  test("pins a Driver with a running Invocation", async () => {
    const { reconciler, set, released } = makeReconciler({
      running: ["driver-1"],
      pinned: [],
    });

    expect(await reconciler.tick()).toEqual({ set: 1, released: 0 });
    expect(set).toEqual(["driver-1"]);
    expect(released).toEqual([]);
  });

  // TEST_SCENARIO: whichever path ended the Driver's last Invocation — a result, a failed setup, a deadline — the next tick releases its pin.
  test("releases a Driver whose Invocations have all ended", async () => {
    const { reconciler, set, released } = makeReconciler({
      running: ["driver-2"],
      pinned: ["driver-1", "driver-2"],
    });

    expect(await reconciler.tick()).toEqual({ set: 0, released: 1 });
    expect(set).toEqual([]);
    expect(released).toEqual(["driver-1"]);
  });

  // TEST_SCENARIO: a pin that cannot be written for one Driver (it was deleted meanwhile) must not stop the others from being reconciled.
  test("one failed write does not stop the rest", async () => {
    const { reconciler, set, logs } = makeReconciler({
      running: ["gone-driver", "driver-1"],
      pinned: [],
      failSet: "gone-driver",
    });

    expect(await reconciler.tick()).toEqual({ set: 1, released: 0 });
    expect(set).toEqual(["driver-1"]);
    expect(logs[0]).toContain("set gone-driver failed: gone");
  });
});
