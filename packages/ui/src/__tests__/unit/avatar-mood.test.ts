// TEST_OVERVIEW: An avatar's mood follows the agent's state: awake while it runs, asleep while it sleeps or falls asleep, and disabled — asleep and grey — while its owner has disabled it, whatever its pod does.
import { describe, expect, it } from "vitest";

import { avatarMood } from "../../modules/agents/components/avatar/agent-avatar.js";

const agent = (over: { stopRequested?: boolean; disabled?: boolean } = {}) => ({
  stopRequested: false,
  disabled: false,
  ...over,
});

describe("avatarMood", () => {
  // TEST_SCENARIO: a running agent is awake, and a hibernated or hibernating one is asleep.
  it("reads awake or asleep from the lifecycle state", () => {
    expect(avatarMood("running", agent())).toBe("awake");
    expect(avatarMood("hibernated", agent())).toBe("asleep");
    expect(avatarMood("hibernating", agent())).toBe("asleep");
  });

  // TEST_SCENARIO: a standing stop request means the agent is going down, so it already reads asleep.
  it("reads asleep while a stop request stands", () => {
    expect(avatarMood("running", agent({ stopRequested: true }))).toBe(
      "asleep",
    );
  });

  // TEST_SCENARIO: disabled wins over every state, since a disabled agent carries a stop request too and must read grey, not just asleep.
  it("reads disabled before anything else", () => {
    expect(
      avatarMood("running", agent({ stopRequested: true, disabled: true })),
    ).toBe("disabled");
    expect(avatarMood("disabled", null)).toBe("disabled");
  });
});
