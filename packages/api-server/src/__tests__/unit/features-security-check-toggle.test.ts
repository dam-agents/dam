// TEST_OVERVIEW: the `security-check` switch gives and takes away the weekly check, since a flag change makes no new request context. Turning it on asks for the check and turning it off asks to remove it. A step that failed puts the switch back where it was and its error reaches the person, so the switch never promises a check nothing made.
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { describe, expect, it, vi } from "vitest";

function setup(opts: { enableFails?: boolean; disableFails?: boolean } = {}) {
  const stored: Record<string, boolean> = {};
  const setFlag = vi.fn(async (feature: string, enabled: boolean) => {
    stored[feature] = enabled;
    return { ...stored };
  });
  const enable = vi.fn(async () => {
    if (opts.enableFails === true) throw new Error("you have no assistant");
  });
  const disable = vi.fn(async () => {
    if (opts.disableFails === true) throw new Error("the schedule stayed");
  });
  const ctx = {
    features: { flags: async () => ({ ...stored }), setFlag },
    securityChecks: { enable, disable },
    optInAssistant: vi.fn(),
    terms: { isAccepted: async () => true },
    user: { sub: "user-1", preferredUsername: "u", scopes: [], agentIds: "*" },
  } as unknown as ApiContext;
  return {
    caller: appRouter.createCaller(ctx),
    setFlag,
    enable,
    disable,
    stored,
  };
}

describe("the security check switch", () => {
  // TEST_SCENARIO: switching it on writes the flag and gives the assistant its weekly check.
  it("gives the check when it is switched on", async () => {
    const w = setup();
    await w.caller.features.setFlag({
      feature: "security-check",
      enabled: true,
    });
    expect(w.stored["security-check"]).toBe(true);
    expect(w.enable).toHaveBeenCalledTimes(1);
    expect(w.disable).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: switching it off writes the flag and takes the check away.
  it("takes the check away when it is switched off", async () => {
    const w = setup();
    await w.caller.features.setFlag({
      feature: "security-check",
      enabled: false,
    });
    expect(w.stored["security-check"]).toBe(false);
    expect(w.disable).toHaveBeenCalledTimes(1);
    expect(w.enable).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the person has no assistant, so nothing was made: they are told why and the switch reads off.
  it("reports a failed start and leaves the switch off", async () => {
    const w = setup({ enableFails: true });
    await expect(
      w.caller.features.setFlag({ feature: "security-check", enabled: true }),
    ).rejects.toThrow("you have no assistant");
    expect(w.stored["security-check"]).toBe(false);
  });

  // TEST_SCENARIO: the Schedule could not be deleted, so the check still runs: the person is told and the switch reads on.
  it("reports a failed removal and leaves the switch on", async () => {
    const w = setup({ disableFails: true });
    await expect(
      w.caller.features.setFlag({ feature: "security-check", enabled: false }),
    ).rejects.toThrow("the schedule stayed");
    expect(w.stored["security-check"]).toBe(true);
  });
});
