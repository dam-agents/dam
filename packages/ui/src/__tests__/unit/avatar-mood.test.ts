// TEST_OVERVIEW: An avatar is awake whatever the agent's machine does, stopped for idleness or by a stop request included, since that is no state the person acts on; it is disabled — asleep and grey — only while its owner has disabled the agent, whatever its pod does.
import { describe, expect, it } from "vitest";

import { avatarMood } from "../../modules/agents/components/avatar/agent-avatar.js";

const agent = (over: { disabled?: boolean } = {}) => ({
  disabled: false,
  ...over,
});

describe("avatarMood", () => {
  // TEST_SCENARIO: a running agent, and one stopped or stopping for idleness, is awake.
  it("reads awake whatever the machine does", () => {
    expect(avatarMood("running", agent())).toBe("awake");
    expect(avatarMood("hibernated", agent())).toBe("awake");
    expect(avatarMood("hibernating", agent())).toBe("awake");
  });

  // TEST_SCENARIO: a disabled agent reads disabled in every state.
  it("reads disabled before anything else", () => {
    expect(avatarMood("running", agent({ disabled: true }))).toBe("disabled");
    expect(avatarMood("disabled", null)).toBe("disabled");
  });
});
