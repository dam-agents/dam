// TEST_OVERVIEW: messages between an agent's Sessions travel as session-message events with their own key and a one-hour life; a message that fails or expires comes back to its sender as a platform notice, a delivered one sends nothing back, and a notice that fails is only logged, so notices never loop.
import type { EventReportInput } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import {
  createSessionMessages,
  SESSION_MESSAGE_TTL_MS,
  type SessionMessageEvent,
} from "../../modules/runtime-delivery/services/session-messages.js";
import type { PendingEventRow } from "../../modules/runtime-delivery/infrastructure/outbox-repo.js";

function setup(
  capabilities: unknown = { contributions: [], events: ["session-message"] },
) {
  const bumped: { agentId: string; events: SessionMessageEvent[] }[] = [];
  const enqueued: string[] = [];
  const logs: string[] = [];
  let id = 0;
  const service = createSessionMessages({
    runtimeMutator: {
      bump: async (agentId, events) => {
        bumped.push({ agentId, events: events as SessionMessageEvent[] });
        return 1;
      },
      enqueueAfterCommit: async (agentId) => {
        enqueued.push(agentId);
      },
      supersede: async () => {},
    },
    readCapabilities: async () => capabilities,
    newId: () => `m${++id}`,
    now: () => 1_000,
    log: (msg) => logs.push(msg),
  });
  return { service, bumped, enqueued, logs };
}

const message = {
  sessionId: "s-dev",
  text: "Stop: the spec changed.",
  from: {
    sessionId: "s-slack",
    title: "Thread in #dev",
    type: "channel_slack",
  },
};

function row(payload: unknown): PendingEventRow {
  return {
    id: "session-message:agent-1:m1:1000",
    agentId: "agent-1",
    kind: "session-message",
    payload,
    version: 1,
    expiresAt: new Date(0),
  };
}

const failed = (detail?: string): EventReportInput => ({
  eventId: "session-message:agent-1:m1:1000",
  outcome: "failed",
  stage: "run",
  ...(detail && { detail }),
});

describe("session messages", () => {
  // TEST_SCENARIO: a message is written to the outbox under a key of its own with a one-hour life, then the agent's delivery is enqueued.
  it("writes one event per message and enqueues delivery", async () => {
    const { service, bumped, enqueued } = setup();
    await service.send("agent-1", message);
    await service.send("agent-1", message);
    expect(bumped.map((b) => b.events[0]!.id)).toEqual([
      "session-message:agent-1:m1:1000",
      "session-message:agent-1:m2:1000",
    ]);
    expect(bumped[0]!.events[0]).toMatchObject({
      kind: "session-message",
      payload: message,
      expiresAt: new Date(1_000 + SESSION_MESSAGE_TTL_MS),
    });
    expect(enqueued).toEqual(["agent-1", "agent-1"]);
  });

  // TEST_SCENARIO: only a runtime that advertises the session-message kind accepts messages; missing or malformed capabilities refuse.
  it("accepts only where the runtime advertises the kind", async () => {
    expect(await setup().service.accepts("agent-1")).toBe(true);
    expect(
      await setup({ contributions: [], events: ["trigger"] }).service.accepts(
        "agent-1",
      ),
    ).toBe(false);
    expect(await setup(null).service.accepts("agent-1")).toBe(false);
    expect(await setup("garbage").service.accepts("agent-1")).toBe(false);
  });

  // TEST_SCENARIO: a failed delivery sends the sender a notice with the reason and a quote of the message.
  it("tells the sender when its message failed", async () => {
    const { service, bumped } = setup();
    await service.onOutcome(row(message), failed("the session has no model"));
    expect(bumped).toHaveLength(1);
    const notice = bumped[0]!.events[0]!.payload;
    expect(notice).toMatchObject({
      sessionId: "s-slack",
      from: {},
      notice: true,
    });
    expect(notice.text).toContain(
      "Your message to session s-dev was not delivered: the session has no model",
    );
    expect(notice.text).toContain('"Stop: the spec changed."');
  });

  // TEST_SCENARIO: a message that expired undelivered sends the sender a notice; a delivered one, or one settled into the runtime, sends nothing.
  it("tells the sender about an expired message, and nothing on success", async () => {
    const { service, bumped } = setup();
    await service.onOutcome(row(message), { ...failed(), outcome: "ok" });
    await service.onLifecycle(row(message), "settled");
    expect(bumped).toEqual([]);
    await service.onLifecycle(row(message), "expired");
    expect(bumped[0]!.events[0]!.payload).toMatchObject({
      sessionId: "s-slack",
      notice: true,
    });
    expect(bumped[0]!.events[0]!.payload.text).toContain("waited an hour");
  });

  // TEST_SCENARIO: a failed notice is logged and sends nothing, and a message without a known sender has nobody to tell.
  it("never answers a notice, and has nobody to tell without a sender", async () => {
    const { service, bumped, logs } = setup();
    await service.onOutcome(
      row({ sessionId: "s-slack", text: "x", from: {}, notice: true }),
      failed("gone"),
    );
    await service.onLifecycle(
      row({ sessionId: "s-slack", text: "x", from: {}, notice: true }),
      "expired",
    );
    await service.onOutcome(row({ ...message, from: {} }), failed("gone"));
    await service.onOutcome(row({ broken: true }), failed("gone"));
    expect(bumped).toEqual([]);
    expect(logs).toHaveLength(2);
  });

  // TEST_SCENARIO: a long message is quoted short in the notice.
  it("quotes a long message briefly", async () => {
    const { service, bumped } = setup();
    await service.onOutcome(
      row({ ...message, text: "a ".repeat(500) }),
      failed("gone"),
    );
    const text = bumped[0]!.events[0]!.payload.text;
    expect(text.length).toBeLessThan(400);
    expect(text).toContain("…");
  });
});
