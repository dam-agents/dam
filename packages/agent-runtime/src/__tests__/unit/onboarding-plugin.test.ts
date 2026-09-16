// TEST_OVERVIEW: the onboarding event opens the new agent's first chat session
// TEST_OVERVIEW: with the platform-composed prompt, typed as a regular session so
// TEST_OVERVIEW: the user sees it in the default list and can answer it; the
// TEST_OVERVIEW: plugin handles no other kind.
import { SessionMode, SessionType } from "api-server-api";
import type { EventContext } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import type { TriggerSessionDriver } from "../../modules/acp/index.js";
import { createOnboardingPlugin } from "../../modules/runtime-channel/drivers/onboarding-plugin.js";

const ctx: EventContext = {
  eventId: "evt-1:1",
  agentHome: "",
  pluginStateDir: "",
  log: () => {},
};

function fakeDriver() {
  const calls: Parameters<TriggerSessionDriver["start"]>[0][] = [];
  const driver: TriggerSessionDriver = {
    async start(opts) {
      calls.push(opts);
      return { sessionId: "s-1" };
    },
  };
  return { driver, calls };
}

describe("onboarding plugin", () => {
  it("starts a fresh regular chat session with the composed prompt", async () => {
    const { driver, calls } = fakeDriver();
    const handler = createOnboardingPlugin({ driver }).bindEvent!(
      "onboarding",
      { impl: "onboarding" },
    );
    await handler({ task: "You were created from a kit." }, ctx);
    expect(calls).toEqual([
      {
        task: "You were created from a kit.",
        platformMeta: {
          type: SessionType.Regular,
          mode: SessionMode.Chat,
          onboarding: true,
        },
      },
    ]);
  });

  it("refuses to bind any other kind", () => {
    const { driver } = fakeDriver();
    expect(() =>
      createOnboardingPlugin({ driver }).bindEvent!("trigger", {
        impl: "onboarding",
      }),
    ).toThrow(/does not handle event kind "trigger"/);
  });
});
