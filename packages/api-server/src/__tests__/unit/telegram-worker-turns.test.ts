import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelegramUser } from "@chat-adapter/telegram";
import { configureLogger } from "../../core/logger.js";
import { telegramWorkerHarness } from "../helpers/telegram-worker.js";

configureLogger({ level: "error", write: () => {} });

/**
 * TEST_OVERVIEW: How the Telegram worker turns a polled message into an agent
 * turn. Every turn carries the reply contract, because an agent answers
 * Telegram only by calling its send tool and treats a message without the
 * contract as one from somewhere else. A message is only queued while the
 * adapter waits on it, so a running turn never stops the bot from reading
 * Telegram.
 */

const JANE: TelegramUser = {
  id: 7,
  is_bot: false,
  first_name: "Jane",
  username: "jane",
};
const OMAR: TelegramUser = {
  id: 8,
  is_bot: false,
  first_name: "Omar",
  username: "omar",
};

let stop: () => Promise<void> = async () => {};

afterEach(async () => {
  await stop();
  vi.unstubAllGlobals();
});

async function started(h: ReturnType<typeof telegramWorkerHarness>) {
  vi.stubGlobal("fetch", h.botApi);
  await h.worker.start();
  stop = () => h.worker.stopAll();
  return h;
}

function held() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { turn: () => gate, release };
}

describe("telegram worker turns", () => {
  /**
   * TEST_SCENARIO: The reported bug. Only a chat's first message started a
   * session with the contract; later ones resumed it with bare text, and the
   * contract told the agent to answer such a message in plain text, which
   * never reaches Telegram. A resumed turn must carry the contract, the chat to
   * answer in, and who sent the message.
   */
  it("carries the reply contract on a turn that resumes the chat's session", async () => {
    const h = await started(
      telegramWorkerHarness({
        sessions: [
          { sessionId: "s-chat", platform: { threadTs: "telegram:7" } },
        ],
      }),
    );

    h.sendDirect(JANE, "and one more thing");

    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    const [{ prompt, opts }] = h.prompts as [(typeof h.prompts)[number]];
    expect(opts).toMatchObject({ resumeSessionId: "s-chat" });
    expect(prompt).toContain("send_channel_message");
    expect(prompt).toContain('chatId="telegram:7"');
    expect(prompt).toContain("@jane, id=7");
    expect(prompt).toContain("<permission-check>");
    expect(prompt).toContain("Message: and one more thing");
  });

  /**
   * TEST_SCENARIO: The adapter does not poll again until every update it
   * handed over is handled. A message held until its agent turn ended stopped
   * the bot from reading any chat for that long, so another chat's message
   * must start its turn while the first turn still runs.
   */
  it("starts another chat's turn while a turn is still running", async () => {
    const first = held();
    const h = await started(telegramWorkerHarness({ turn: first.turn }));
    try {
      h.sendDirect(JANE, "a long question");
      await vi.waitFor(() => expect(h.prompts).toHaveLength(1));

      h.sendDirect(OMAR, "a quick one");

      await vi.waitFor(() => expect(h.prompts).toHaveLength(2));
      expect(h.prompts[1]!.prompt).toContain("Message: a quick one");
    } finally {
      first.release();
    }
  });

  /**
   * TEST_SCENARIO: A turn that fails with an error nobody classified used to
   * leave the Telegram chat in silence. A person now gets the same sentence
   * Slack posts for it, so a failed turn is never silent on either surface.
   */
  it("posts the generic failure sentence for an unclassified error", async () => {
    const h = await started(
      telegramWorkerHarness({
        turn: () => Promise.reject(new Error("the relay fell over")),
      }),
    );

    h.sendDirect(JANE, "a question");

    await vi.waitFor(() =>
      expect(h.posts).toContain(
        "Something went wrong while relaying this message — try again.",
      ),
    );
  });

  /**
   * TEST_SCENARIO: A follow-up in the same chat while its turn runs is steered
   * into that turn, so the agent reads it before it answers and the chat gets
   * one answer, as the shared conversation queue intends.
   */
  it("steers a follow-up in the same chat into the running turn", async () => {
    const first = held();
    const steer = vi.fn(async () => "injected" as const);
    const h = await started(telegramWorkerHarness({ turn: first.turn, steer }));
    try {
      h.sendDirect(JANE, "a long question");
      await vi.waitFor(() => expect(h.prompts).toHaveLength(1));

      h.sendDirect(JANE, "oh, and also this");

      await vi.waitFor(() =>
        expect(steer).toHaveBeenCalledWith(
          "s-1",
          expect.stringContaining("oh, and also this"),
        ),
      );
      expect(h.prompts).toHaveLength(1);
    } finally {
      first.release();
    }
  });
});

describe("telegram group turns", () => {
  /**
   * TEST_SCENARIO: The reported bug. With Group Privacy on, a reply to the
   * bot is the one plain message Telegram still delivers, and the worker
   * dropped it because it carried no mention. A reply to the bot is addressed
   * to the agent and reaches it while ambient mode is off.
   */
  it("answers a reply to the bot while ambient mode is off", async () => {
    const h = await started(telegramWorkerHarness());

    h.sendGroup(JANE, "yo", { replyToBot: true });

    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    expect(h.prompts[0]!.prompt).toContain("mentions you or replies to you");
    expect(h.prompts[0]!.prompt).toContain("Message: yo");
  });

  /**
   * TEST_SCENARIO: With ambient mode off, chatter nobody addressed never
   * reaches the agent, while a mention right after it does.
   */
  it("passes on only the mention while ambient mode is off", async () => {
    const h = await started(telegramWorkerHarness());

    h.sendGroup(OMAR, "lunch at noon?");
    h.sendGroup(JANE, "@krodo_bot what is on the agenda?");

    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    expect(h.prompts[0]!.prompt).toContain("what is on the agenda?");
    expect(h.prompts[0]!.prompt).not.toContain("lunch at noon?");
  });

  /**
   * TEST_SCENARIO: With ambient mode on, chatter reaches the agent framed as
   * reading along, so it chimes in only when it can clearly help.
   */
  it("reads along with chatter while ambient mode is on", async () => {
    const h = await started(telegramWorkerHarness({ ambient: true }));

    h.sendGroup(OMAR, "lunch at noon?");

    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    expect(h.prompts[0]!.prompt).toContain("you are reading along");
    expect(h.prompts[0]!.prompt).toContain("Message: lunch at noon?");
  });

  /**
   * TEST_SCENARIO: A read-along turn posts nothing when it fails. A mention
   * steered into one would lose its failure notice, so a mention that
   * arrives while a read-along turn runs waits and gets an addressed turn of
   * its own.
   */
  it("gives a mention its own turn instead of steering it into a read-along turn", async () => {
    const first = held();
    const steer = vi.fn(async () => "injected" as const);
    const h = await started(
      telegramWorkerHarness({ ambient: true, turn: first.turn, steer }),
    );
    try {
      h.sendGroup(OMAR, "lunch at noon?");
      await vi.waitFor(() => expect(h.prompts).toHaveLength(1));

      h.sendGroup(JANE, "@krodo_bot what is on the agenda?");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(steer).not.toHaveBeenCalled();

      first.release();
      await vi.waitFor(() => expect(h.prompts).toHaveLength(2));
      expect(h.prompts[1]!.prompt).toContain("mentions you or replies to you");
      expect(h.prompts[1]!.prompt).toContain("what is on the agenda?");
    } finally {
      first.release();
    }
  });

  /**
   * TEST_SCENARIO: An operator changes Group Privacy in BotFather while the
   * bot runs. The `/ambient on` heads-up must follow the bot's setting at
   * that moment, not the one it had when it started.
   */
  it("bases the Group Privacy heads-up on the bot's current setting", async () => {
    const groupPrivacy = { on: true };
    const h = await started(telegramWorkerHarness({ groupPrivacy }));

    groupPrivacy.on = false;
    h.sendGroup(JANE, "/ambient on");
    await vi.waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.posts[0]).toContain("Ambient mode turned on");
    expect(h.posts[0]).not.toContain("Group Privacy");

    groupPrivacy.on = true;
    h.sendGroup(JANE, "/ambient on");
    await vi.waitFor(() => expect(h.posts).toHaveLength(2));
    expect(h.posts[1]).toContain("Group Privacy");
  });
});
