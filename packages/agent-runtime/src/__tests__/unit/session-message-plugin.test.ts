// TEST_OVERVIEW: a message one Session sends into another arrives in the target Session as a steerable, unattended prompt that names its sender, and the sender learns whether it was delivered.
import type { EventContext, EventReportInput } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import type { TriggerSessionDriver } from "../../modules/acp/index.js";
import {
  createSessionMessagePlugin,
  sessionMessagePrompt,
} from "../../modules/runtime-channel/drivers/session-message-plugin.js";

const ctx: EventContext = {
  eventId: "session-message:agent-1:m1:1",
  agentHome: "",
  pluginStateDir: "",
  log: () => {},
};

function setup(fail?: Error) {
  const calls: Parameters<TriggerSessionDriver["start"]>[0][] = [];
  const reports: EventReportInput[] = [];
  const driver: TriggerSessionDriver = {
    async start(opts) {
      calls.push(opts);
      if (fail) throw fail;
      return { sessionId: opts.resumeSessionId ?? "s-new", openedOn: null };
    },
  };
  const handler = createSessionMessagePlugin({
    driver,
    reporter: {
      report: async (input) => {
        reports.push(input);
      },
    },
    log: () => {},
  }).bindEvent!("session-message", { impl: "session-message" });
  return { handler, calls, reports };
}

const payload = {
  sessionId: "s-dev",
  text: "Stop: the spec changed.",
  from: { sessionId: "s-slack", title: "Thread in #dev", type: "channel_slack" },
};

describe("session-message plugin", () => {
  // TEST_SCENARIO: the message resumes the target Session, keeps its model, may steer into a running turn, and reports ok.
  it("delivers into the target Session as a steerable prompt", async () => {
    const { handler, calls, reports } = setup();
    await handler(payload, ctx);
    expect(calls).toEqual([
      {
        task: sessionMessagePrompt(payload.from, payload.text),
        resumeSessionId: "s-dev",
        unattended: true,
        steer: true,
        keepSessionModel: true,
      },
    ]);
    expect(reports).toEqual([
      { eventId: ctx.eventId, outcome: "ok", stage: "run" },
    ]);
  });

  // TEST_SCENARIO: the prompt names the sending Session so the receiving turn can tell who is talking, and says a reply stays where it is.
  it("frames the text with its sender", () => {
    const prompt = sessionMessagePrompt(payload.from, payload.text);
    expect(prompt).toContain('"Thread in #dev"');
    expect(prompt).toContain("session s-slack");
    expect(prompt).toContain("does not reach it");
    expect(prompt.endsWith("\n\nStop: the spec changed.")).toBe(true);
    expect(sessionMessagePrompt({}, "hi")).toBe(
      "[Message from another session of this agent. Your reply here does not reach it.]\n\nhi",
    );
  });

  // TEST_SCENARIO: a target Session that cannot be resumed reports failed with the reason instead of retrying the event.
  it("reports a delivery it could not make", async () => {
    const { handler, reports } = setup(new Error("session not found"));
    await handler(payload, ctx);
    expect(reports).toEqual([
      {
        eventId: ctx.eventId,
        outcome: "failed",
        stage: "run",
        detail: "the message could not be delivered: session not found",
      },
    ]);
  });
});
