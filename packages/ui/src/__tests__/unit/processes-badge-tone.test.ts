// TEST_OVERVIEW: The Processes badge carries the accent colour only while a counted process holds the Agent awake; a count that keeps nothing awake stays neutral.
import { expect, it } from "vitest";

import { processesBadgeTone } from "../../modules/processes/lib/process-summary.js";

it("stays neutral while no process keeps the agent awake", () => {
  expect(
    processesBadgeTone({ running: 3, keepingAwake: 0, restartPending: false }),
  ).toBe("neutral");
});

it("takes the accent colour once a process keeps the agent awake", () => {
  expect(
    processesBadgeTone({ running: 2, keepingAwake: 1, restartPending: false }),
  ).toBeUndefined();
});
