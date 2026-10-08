import { describe, expect, it } from "vitest";

import { isNewOutOfMemoryRestart } from "../../modules/agents/domain/out-of-memory.js";

// TEST_OVERVIEW: an Agent's status holds only its latest restart count and
// TEST_OVERVIEW: reason, so an out-of-memory restart is recognised from the count
// TEST_OVERVIEW: changing while the reason is out of memory.

describe("out-of-memory restart detection", () => {
  // TEST_SCENARIO: the first observation of an Agent is the baseline, so a
  // TEST_SCENARIO: restarted api-server does not report old restarts again.
  it("reports nothing for an Agent seen for the first time", () => {
    expect(
      isNewOutOfMemoryRestart(undefined, {
        restarts: 3,
        reason: "OutOfMemory",
      }),
    ).toBe(false);
  });

  // TEST_SCENARIO: the count rises with the out-of-memory reason: a new restart.
  it("reports a rising count with the out-of-memory reason", () => {
    expect(
      isNewOutOfMemoryRestart(
        { restarts: 1, reason: "OutOfMemory" },
        { restarts: 2, reason: "OutOfMemory" },
      ),
    ).toBe(true);
    expect(
      isNewOutOfMemoryRestart(
        { restarts: 1, reason: "OutOfMemory" },
        { restarts: 2, reason: "Error" },
      ),
    ).toBe(false);
  });

  // TEST_SCENARIO: the pod was replaced and the watch reconnected, so the count
  // TEST_SCENARIO: it next sees is lower than the baseline but still names an
  // TEST_SCENARIO: out-of-memory restart of the new pod.
  it("treats a lower non-zero count as a restart of a replaced pod", () => {
    expect(
      isNewOutOfMemoryRestart(
        { restarts: 2, reason: "OutOfMemory" },
        { restarts: 1, reason: "OutOfMemory" },
      ),
    ).toBe(true);
    expect(
      isNewOutOfMemoryRestart(
        { restarts: 2, reason: "OutOfMemory" },
        { restarts: 0, reason: undefined },
      ),
    ).toBe(false);
  });
});
