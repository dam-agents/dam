import { expect, test } from "vitest";

import { overlayDescription } from "../../modules/agents/lib/overlay-copy.js";
import type { AgentView } from "../../types.js";

const agent = (vm: boolean) => ({ vm }) as unknown as AgentView;

// TEST_SCENARIO: an agent that can't start for its owner's full pool or budget tells the user how to make room. The restored UI offers Stop and Pause but no Disable, so the advice names Stop.
test("a full pool or budget points at Stop", () => {
  expect(overlayDescription("over_budget", agent(true))).toBe(
    "Your VM agents' memory is full. It starts once room frees up — or stop an agent you aren't using.",
  );
  expect(overlayDescription("over_budget", agent(false))).toBe(
    "Starting this agent would exceed your compute budget. Stop agents you aren't using to free room, then start this one again.",
  );
});
