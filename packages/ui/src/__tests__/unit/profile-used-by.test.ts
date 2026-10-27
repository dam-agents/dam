// TEST_OVERVIEW: The refusal to delete a profile in use names what uses it as one phrase per kind, so two agents read "the agents Reginald and Celestine" rather than a list of "the agent …" (QA N6).
import { expect, it } from "vitest";

import { usedBy } from "../../modules/profiles/lib/profile-detail.js";

/** TEST_SCENARIO: one name per kind reads singular, several read plural with "and" before the last, and the kinds follow each other. */
it("names each kind once", () => {
  expect(
    usedBy({ agents: ["Reginald", "Celestine"], channels: [], schedules: [] }),
  ).toBe("the agents Reginald and Celestine");
  expect(
    usedBy({
      agents: ["Reginald"],
      channels: ["#ops"],
      schedules: ["“Nightly”", "“Weekly”", "“Monthly”"],
    }),
  ).toBe(
    "the agent Reginald, the channel #ops, the schedules “Nightly”, “Weekly” and “Monthly”",
  );
});
