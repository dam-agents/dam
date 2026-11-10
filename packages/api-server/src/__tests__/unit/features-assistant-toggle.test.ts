// TEST_OVERVIEW: turning the `dambledore` switch on asks the context to give the
// TEST_OVERVIEW: person Dambledore, since a flag change makes no new request
// TEST_OVERVIEW: context; turning it off, and every other feature's switch, only
// TEST_OVERVIEW: writes the flag. A create that failed is reported to the person and
// TEST_OVERVIEW: leaves the switch off rather than showing one that promises an
// TEST_OVERVIEW: assistant nothing made.
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { describe, expect, it, vi } from "vitest";

function setup(opts: { fails?: boolean } = {}) {
  const stored: Record<string, boolean> = {};
  const setFlag = vi.fn(async (feature: string, enabled: boolean) => {
    stored[feature] = enabled;
    return { ...stored };
  });
  const optInAssistant = vi.fn(async () => {
    if (opts.fails === true) throw new Error("the create was refused");
  });
  const ctx = {
    features: { flags: async () => ({ ...stored }), setFlag },
    optInAssistant,
    terms: { isAccepted: async () => true },
    user: { sub: "user-1", preferredUsername: "u", scopes: [], agentIds: "*" },
  } as unknown as ApiContext;
  return {
    caller: appRouter.createCaller(ctx),
    setFlag,
    optInAssistant,
    stored,
  };
}

describe("the dambledore switch", () => {
  // TEST_SCENARIO: switching the assistant on writes the flag and gives the person Dambledore.
  it("gives the person the assistant when it is switched on", async () => {
    const w = setup();
    await w.caller.features.setFlag({ feature: "dambledore", enabled: true });
    expect(w.setFlag).toHaveBeenCalledWith("dambledore", true);
    expect(w.optInAssistant).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: switching it off removes nothing, so nothing is asked of the assistant beyond the flag, and another feature's switch is the flag alone.
  it("asks for nothing when it is switched off, or another feature is", async () => {
    const w = setup();
    await w.caller.features.setFlag({ feature: "dambledore", enabled: false });
    await w.caller.features.setFlag({ feature: "chat-forms", enabled: true });
    expect(w.setFlag).toHaveBeenCalledTimes(2);
    expect(w.optInAssistant).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the create failed, so the person is told and the switch reads off: the flag is written back and the create's own failure is the one they see.
  it("reports a failed create and leaves the switch off", async () => {
    const w = setup({ fails: true });
    await expect(
      w.caller.features.setFlag({ feature: "dambledore", enabled: true }),
    ).rejects.toThrow("the create was refused");
    expect(w.stored.dambledore).toBe(false);
    expect(w.setFlag).toHaveBeenLastCalledWith("dambledore", false);
  });
});
