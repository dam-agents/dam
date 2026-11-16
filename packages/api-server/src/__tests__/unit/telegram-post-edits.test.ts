// TEST_OVERVIEW: An Agent changes a post it made earlier in Telegram. A text post an Agent makes with its own tool now names its chat and message, and the Agent that made it can change it in place. A Telegram message carries nothing that names its Agent and message ids in a chat can be guessed, so only a message the platform recorded for the calling Agent is changed: another Agent is refused even after the chat moved to it, and so is a message nobody recorded, such as a notice the platform sent in the Agent's name.
import type { TelegramUser } from "@chat-adapter/telegram";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLogger } from "../../core/logger.js";
import type { ChannelSendResult } from "../../modules/channels/services/channel-manager.js";
import { telegramWorkerHarness } from "../helpers/telegram-worker.js";

configureLogger({ level: "error", write: () => {} });

const JANE: TelegramUser = {
  id: 7,
  is_bot: false,
  first_name: "Jane",
  username: "jane",
};

let stop: () => Promise<void> = async () => {};

afterEach(async () => {
  await stop();
  vi.unstubAllGlobals();
});

async function posted(text: string, byAgent = true) {
  const results: ChannelSendResult[] = [];
  const bound = { agent: "agent-1" };
  const worker: { post?: () => Promise<ChannelSendResult> } = {};
  const h = telegramWorkerHarness({
    boundAgent: () => bound.agent,
    turn: async () => {
      results.push(await worker.post!());
    },
  });
  worker.post = () =>
    h.worker.postMessage("agent-1", text, byAgent ? { byAgent } : {});
  vi.stubGlobal("fetch", h.botApi);
  await h.worker.start();
  stop = () => h.worker.stopAll();
  h.sendDirect(JANE, "count to three in one message");
  await vi.waitFor(() => expect(results).toHaveLength(1));
  const post = results[0]!;
  if (!("ok" in post)) throw new Error("the post failed");
  return {
    ...h,
    bound,
    result: post,
    post: {
      conversationId: post.conversationId ?? "",
      messageId: post.ts ?? "",
    },
  };
}

describe("an agent changes its own Telegram post", () => {
  // TEST_SCENARIO: the agent keeps one message current; the change goes to that same message, and no new message is sent.
  it("changes the message in place", async () => {
    const h = await posted("step 1 of 3");

    const result = await h.worker.editPost("agent-1", {
      ...h.post,
      text: "step 2 of 3",
    });

    expect(result).toMatchObject({ ok: true, ts: h.post.messageId });
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0]!.text).toContain("step 2 of 3");
    expect(h.posts).toEqual(["step 1 of 3"]);
  });

  // TEST_SCENARIO: a chat moves to another agent, which then names a message the first agent made; message ids in a chat can be guessed, so the binding alone must not let it through.
  it("refuses another agent, even once the chat is connected to it", async () => {
    const h = await posted("step 1 of 3");
    h.bound.agent = "agent-2";

    const result = await h.worker.editPost("agent-2", {
      ...h.post,
      text: "rewritten by someone else",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("not a post you can change"),
    });
    expect(h.edits).toEqual([]);
  });

  // TEST_SCENARIO: the platform sends its own notices to a chat in the agent's name through the same call, such as a spend alert to the owner; the agent did not write them, and their ids are easy to guess from its own, so they name no reference and are never recorded as the agent's.
  it("never lets an agent change a notice the platform sent in its name", async () => {
    const own = await posted("step 1 of 3");
    const notice = await own.worker.postMessage(
      "agent-1",
      "Spend limit reached.",
      { conversationId: own.post.conversationId },
    );
    expect(notice).toEqual({ ok: true });

    const [chat, message] = own.post.messageId.split(":");
    const result = await own.worker.editPost("agent-1", {
      conversationId: own.post.conversationId,
      messageId: `${chat}:${Number(message) + 1}`,
      text: "rewritten",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("not a post you can change"),
    });
    expect(own.edits).toEqual([]);
  });

  it("refuses a message it has no record of", async () => {
    const h = await posted("step 1 of 3");

    const result = await h.worker.editPost("agent-1", {
      ...h.post,
      messageId: `${h.post.messageId}9`,
      text: "step 2 of 3",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("not a post you can change"),
    });
    expect(h.edits).toEqual([]);
  });

  it("refuses a chat that is not connected to the agent", async () => {
    const h = await posted("step 1 of 3");

    const result = await h.worker.editPost("agent-2", {
      ...h.post,
      text: "step 2 of 3",
    });

    expect(result).toMatchObject({
      error: expect.stringContaining("not connected to this agent"),
    });
    expect(h.edits).toEqual([]);
  });
});
