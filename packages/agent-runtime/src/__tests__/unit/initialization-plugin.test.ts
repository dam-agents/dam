// TEST_OVERVIEW: the initialization event opens the new agent's first chat session
// TEST_OVERVIEW: with the turn the platform composed at create, typed as a regular session so
// TEST_OVERVIEW: the user sees it in the default list and can answer it; the
// TEST_OVERVIEW: plugin handles no other kind.
import { SessionMode, SessionType } from "api-server-api";
import type { EventContext } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import type { TriggerSessionDriver } from "../../modules/acp/index.js";
import { createInitializationPlugin } from "../../modules/runtime-channel/drivers/initialization-plugin.js";

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

describe("initialization plugin", () => {
  it("starts a fresh regular chat session with the composed prompt", async () => {
    const { driver, calls } = fakeDriver();
    const handler = createInitializationPlugin({ driver }).bindEvent!(
      "initialization",
      { impl: "initialization" },
    );
    await handler({ task: "You were created from a kit." }, ctx);
    expect(calls).toEqual([
      {
        task: "You were created from a kit.",
        platformMeta: {
          type: SessionType.Regular,
          mode: SessionMode.Chat,
          initialization: true,
        },
      },
    ]);
  });

  it("refuses to bind any other kind", () => {
    const { driver } = fakeDriver();
    expect(() =>
      createInitializationPlugin({ driver }).bindEvent!("trigger", {
        impl: "initialization",
      }),
    ).toThrow(/does not handle event kind "trigger"/);
  });
});
