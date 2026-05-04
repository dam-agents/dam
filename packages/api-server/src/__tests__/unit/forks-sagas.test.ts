import { describe, it, expect, beforeEach } from "vitest";
import { EventType, emit } from "../../events.js";
import { startOnForeignReplySaga } from "../../modules/forks/sagas/on-foreign-reply.js";
import { startOnSlackTurnRelayedSaga } from "../../modules/forks/sagas/on-slack-turn-relayed.js";
import type { ForksService, OpenForkInput } from "../../modules/forks/services/forks-service.js";

function makeService(): {
  service: ForksService;
  openCalls: OpenForkInput[];
  closeCalls: string[];
} {
  const openCalls: OpenForkInput[] = [];
  const closeCalls: string[] = [];
  return {
    openCalls,
    closeCalls,
    service: {
      openFork: async (input) => {
        openCalls.push(input);
      },
      closeFork: async (id) => {
        closeCalls.push(id);
      },
    },
  };
}

async function drain(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("on-foreign-reply saga", () => {
  let harness: ReturnType<typeof makeService>;
  let sub: { unsubscribe: () => void };

  beforeEach(() => {
    harness = makeService();
    sub = startOnForeignReplySaga(harness.service);
  });

  it("calls openFork with correlation+identity fields from the event", async () => {
    emit({
      type: EventType.ForeignReplyReceived,
      replyId: "reply-1",
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      threadTs: "1700000000.000100",
      sessionId: "sess-7",
      prompt: "hello",
      slackContext: { channelId: "C123", userSlackId: "U42" },
    });
    await drain();

    expect(harness.openCalls).toEqual([
      {
        instanceId: "inst-1",
        foreignSub: "kc|user-42",
        replyId: "reply-1",
        sessionId: "sess-7",
      },
    ]);
    sub.unsubscribe();
  });

  it("omits sessionId when absent on the event", async () => {
    emit({
      type: EventType.ForeignReplyReceived,
      replyId: "reply-2",
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      threadTs: "1700000000.000200",
      prompt: "hi",
      slackContext: { channelId: "C123", userSlackId: "U42" },
    });
    await drain();

    expect(harness.openCalls[0]).not.toHaveProperty("sessionId");
    sub.unsubscribe();
  });

  it("ignores unrelated events", async () => {
    emit({ type: EventType.InstanceDeleted, instanceId: "inst-1" });
    emit({
      type: EventType.SlackTurnRelayed,
      replyId: "reply-3",
      forkId: "fork-9",
    });
    await drain();

    expect(harness.openCalls).toEqual([]);
    sub.unsubscribe();
  });

  it("does not rethrow when openFork fails (swallowed + logged)", async () => {
    const failing: ForksService = {
      openFork: async () => {
        throw new Error("boom");
      },
      closeFork: async () => {},
    };
    const s = startOnForeignReplySaga(failing);

    expect(() =>
      emit({
        type: EventType.ForeignReplyReceived,
        replyId: "reply-4",
        instanceId: "inst-1",
        foreignSub: "kc|user-42",
        threadTs: "1700000000.000400",
        prompt: "hi",
        slackContext: { channelId: "C123", userSlackId: "U42" },
      }),
    ).not.toThrow();
    await drain();
    s.unsubscribe();
    sub.unsubscribe();
  });
});

describe("on-slack-turn-relayed saga", () => {
  let harness: ReturnType<typeof makeService>;
  let sub: { unsubscribe: () => void };

  beforeEach(() => {
    harness = makeService();
    sub = startOnSlackTurnRelayedSaga(harness.service);
  });

  it("calls closeFork when forkId is present", async () => {
    emit({ type: EventType.SlackTurnRelayed, replyId: "r1", forkId: "fork-1" });
    await drain();

    expect(harness.closeCalls).toEqual(["fork-1"]);
    sub.unsubscribe();
  });

  it("is a no-op when forkId is absent (owner-path turn)", async () => {
    emit({ type: EventType.SlackTurnRelayed, replyId: "r1" });
    await drain();

    expect(harness.closeCalls).toEqual([]);
    sub.unsubscribe();
  });

  it("ignores unrelated events", async () => {
    emit({
      type: EventType.ForeignReplyReceived,
      replyId: "reply-x",
      instanceId: "inst-1",
      foreignSub: "kc|user-42",
      threadTs: "1700000000.000500",
      prompt: "hi",
      slackContext: { channelId: "C123", userSlackId: "U42" },
    });
    await drain();

    expect(harness.closeCalls).toEqual([]);
    sub.unsubscribe();
  });
});
