import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  POD_FAILURE_REASONS,
  describeWakeFailure,
} from "../../modules/agents/domain/wake-failure.js";

/**
 * TEST_OVERVIEW: The VM runner's failure reasons reach an Agent's status as
 * plain strings, and this module names them again to decide which failures end
 * a wake and what to tell the person waiting. The runner and the controller
 * both hold their copy to the machine API's vocabulary; this is the same hold
 * for the api-server's copy, so a reason renamed or dropped there fails here
 * rather than quietly falling through to the generic "crashed while starting".
 */

const vocabulary = JSON.parse(
  readFileSync(
    new URL("../../../../vm-runner/contract/vocabulary.json", import.meta.url),
    "utf8",
  ),
) as { reasons: string[] };

const machineReasons = [...POD_FAILURE_REASONS].filter((r) =>
  r.startsWith("Machine"),
);

describe("the VM runner's failure reasons", () => {
  // TEST_SCENARIO: every machine reason this module treats as a failed wake is one the runner can report.
  it("are all in the machine API's vocabulary", () => {
    expect(machineReasons.length).toBeGreaterThan(0);
    for (const reason of machineReasons) {
      expect(vocabulary.reasons).toContain(reason);
    }
  });

  // TEST_SCENARIO: every machine reason that ends a wake is explained in its own words, not by the generic fallback.
  it("each have their own description", () => {
    const fallback = describeWakeFailure({
      kind: "agent-pod-failed",
      terminationReason: "NotAReason",
    });
    for (const reason of machineReasons) {
      expect(
        describeWakeFailure({
          kind: "agent-pod-failed",
          terminationReason: reason,
        }),
      ).not.toBe(fallback);
    }
  });
});
