// TEST_OVERVIEW: the result of a satellite Job or of a sub-agent reaches the agent as a new turn. Each event carries the agent's saved default, so a new Session it opens runs on that model, and a Session it continues keeps its own model, taking the event's only when it has none.
import { SessionMode, SessionType } from "api-server-api";
import type { EventContext } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import type { TriggerSessionDriver } from "../../modules/acp/index.js";
import {
  createSatelliteOutcomePlugin,
  createSubAgentOutcomePlugin,
} from "../../modules/runtime-channel/drivers/session-event-plugins.js";

const ctx: EventContext = {
  eventId: "evt-1:1",
  agentHome: "",
  pluginStateDir: "",
  log: () => {},
};

const pair = {
  harness: "claude-code",
  provider: "conn-1",
  model: "ibm/aws/claude-sonnet-5-5",
};

function fakeDriver() {
  const calls: Parameters<TriggerSessionDriver["start"]>[0][] = [];
  const driver: TriggerSessionDriver = {
    async start(opts) {
      calls.push(opts);
      return { sessionId: "s-1", openedOn: null };
    },
  };
  return { driver, calls };
}

describe("outcome plugins", () => {
  // TEST_SCENARIO: a satellite outcome opens a regular chat Session on the saved default it carries.
  it("opens a satellite outcome's Session on the event's model", async () => {
    const { driver, calls } = fakeDriver();
    const handler = createSatelliteOutcomePlugin({ driver }).bindEvent!(
      "satellite-outcome",
      { impl: "satellite-outcome" },
    );
    await handler({ task: "Job done.", refs: ["sat#1"], ...pair }, ctx);
    expect(calls[0]?.platformMeta).toEqual({
      type: SessionType.Regular,
      mode: SessionMode.Chat,
      ...pair,
    });
  });

  // TEST_SCENARIO: a sub-agent outcome continuing its spawning Session pins the event's model only if that Session has none; with no Session known it opens a new one on the event's model.
  it("keeps a continued Session's model and opens a new one on the event's", async () => {
    const { driver, calls } = fakeDriver();
    const sessions = new Map([["agent-1", "s-spawner"]]);
    const handler = createSubAgentOutcomePlugin({
      driver,
      sessions: {
        sessionOf: (ids: readonly string[]) => sessions.get(ids[0]!),
      } as never,
    }).bindEvent!("sub-agent-outcome", { impl: "sub-agent-outcome" });
    await handler({ task: "Done.", ids: ["agent-1"], ...pair }, ctx);
    await handler({ task: "Done.", ids: ["agent-2"], ...pair }, ctx);
    expect(calls[0]).toEqual({
      task: "Done.",
      resumeSessionId: "s-spawner",
      model: pair.model,
      keepSessionModel: true,
    });
    expect(calls[1]?.platformMeta).toMatchObject(pair);
  });
});
