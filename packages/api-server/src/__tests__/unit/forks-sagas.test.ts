import { describe, it, expect, beforeEach } from "vitest";
import { EventType, emit } from "../../events.js";
import { startOnForeignReplySaga } from "../../modules/forks/sagas/on-foreign-reply.js";
import { startOnChannelTurnRelayedSaga } from "../../modules/forks/sagas/on-channel-turn-relayed.js";
import type {
  EnsureForkInput,
  ForksService,
} from "../../modules/forks/services/forks-service.js";

function makeService(): {
  service: ForksService;
  ensureCalls: EnsureForkInput[];
  activityCalls: string[];
  endCalls: string[];
} {
  const ensureCalls: EnsureForkInput[] = [];
  const activityCalls: string[] = [];
  const endCalls: string[] = [];
  return {
    ensureCalls,
    activityCalls,
    endCalls,
    service: {
      ensureFork: async (input) => {
        ensureCalls.push(input);
      },
      recordActivity: async (id) => {
        activityCalls.push(id);
      },
      endFork: async (id) => {
        endCalls.push(id);
      },
      resolveIdentity: async () => null,
      listByAgent: async () => [],
      listByReplier: async () => [],
      pokeCredentials: async () => {},
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

  it("ensures the (agent, replier) fork with correlation fields from the event", async () => {
    emit({
      type: EventType.ForeignReplyReceived,
      replyId: "reply-1",
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      threadTs: "1700000000.000100",
      prompt: "hello",
      slackContext: { channelId: "C123", userSlackId: "U42" },
    });
    await drain();

    expect(harness.ensureCalls).toEqual([
      {
        agentId: "inst-1",
        foreignSub: "kc|user-42",
        replyId: "reply-1",
      },
    ]);
    sub.unsubscribe();
  });

  it("ignores unrelated events", async () => {
    emit({ type: EventType.AgentDeleted, agentId: "inst-1" });
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "inst-1",
      actorSub: "kc|owner",
      outcome: "success",
      forkId: "fork-9",
    });
    await drain();

    expect(harness.ensureCalls).toEqual([]);
    sub.unsubscribe();
  });

  it("does not rethrow when ensureFork fails (swallowed + logged)", async () => {
    const failing: ForksService = {
      ensureFork: async () => {
        throw new Error("boom");
      },
      recordActivity: async () => {},
      endFork: async () => {},
      resolveIdentity: async () => null,
      listByAgent: async () => [],
      listByReplier: async () => [],
      pokeCredentials: async () => {},
    };
    const s = startOnForeignReplySaga(failing);

    expect(() =>
      emit({
        type: EventType.ForeignReplyReceived,
        replyId: "reply-4",
        agentId: "inst-1",
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

describe("on-channel-turn-relayed saga", () => {
  let harness: ReturnType<typeof makeService>;
  let sub: { unsubscribe: () => void };

  beforeEach(() => {
    harness = makeService();
    sub = startOnChannelTurnRelayedSaga(harness.service);
  });

  it("stamps fork activity when forkId is present — turns no longer tear the fork down", async () => {
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "inst-1",
      actorSub: "kc|foreign",
      outcome: "success",
      forkId: "fork-1",
    });
    await drain();

    expect(harness.activityCalls).toEqual(["fork-1"]);
    expect(harness.endCalls).toEqual([]);
    sub.unsubscribe();
  });

  it("is a no-op when forkId is absent (owner-path turn)", async () => {
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "inst-1",
      actorSub: "kc|owner",
      outcome: "success",
    });
    await drain();

    expect(harness.activityCalls).toEqual([]);
    sub.unsubscribe();
  });

  it("ignores unrelated events", async () => {
    emit({
      type: EventType.ForeignReplyReceived,
      replyId: "reply-x",
      agentId: "inst-1",
      foreignSub: "kc|user-42",
      threadTs: "1700000000.000500",
      prompt: "hi",
      slackContext: { channelId: "C123", userSlackId: "U42" },
    });
    await drain();

    expect(harness.activityCalls).toEqual([]);
    sub.unsubscribe();
  });
});
