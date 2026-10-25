// TEST_OVERVIEW: What a channel's turn starts on. A fresh session in a channel names the pair the channel's profile resolves to, so it starts there and not on the agent's default; a channel that predates profiles sends nothing and keeps the chain it had; a profile that cannot run on the agent stops the turn with its reason in the thread, instead of running on another model.
import { slackThreadKey, type SessionPair } from "api-server-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelegramUser } from "@chat-adapter/telegram";
import { configureLogger } from "../../core/logger.js";
import { slackWorkerHarness } from "../helpers/slack-worker.js";
import { telegramWorkerHarness } from "../helpers/telegram-worker.js";

configureLogger({ level: "error", write: () => {} });

const JANE: TelegramUser = {
  id: 7,
  is_bot: false,
  first_name: "Jane",
  username: "jane",
};

const PAIR: SessionPair = {
  harness: "claude-code",
  provider: "conn-1",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
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

describe("a channel's turn", () => {
  /** TEST_SCENARIO: the channel names a profile, so the fresh session is created
   * on that profile's pair rather than on whatever the agent defaults to. */
  it("starts a fresh session on the channel's profile", async () => {
    const h = await started(
      telegramWorkerHarness({
        channelPair: async () => ({ kind: "profile", pair: PAIR }),
      }),
    );
    h.sendDirect(JANE, "hello");
    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    const [sent] = h.prompts as (typeof h.prompts)[number][];
    expect(sent?.opts).toMatchObject({
      platformMeta: {
        harness: PAIR.harness,
        provider: PAIR.provider,
        model: PAIR.model,
      },
    });
  });

  /** TEST_SCENARIO: a profile that cannot run stops the turn where it starts and
   * the chat is told the reason, so it never answers on another model. */
  it("refuses a profile that cannot run, and says why in the chat", async () => {
    const h = await started(
      telegramWorkerHarness({
        channelPair: async () => ({
          kind: "unavailable",
          profileName: "Fast review",
          detail: "AWS Bedrock is not connected",
        }),
      }),
    );
    h.sendDirect(JANE, "hello");
    await vi.waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.posts[0]).toContain("Fast review");
    expect(h.posts[0]).toContain("AWS Bedrock is not connected");
    expect(h.prompts).toHaveLength(0);
  });

  /** TEST_SCENARIO: a Slack thread that is already running keeps the values it
   * runs on, so a profile that has since become unavailable does not refuse it —
   * the same rule Telegram follows (D94 A, D119). */
  it("does not refuse a resumed Slack thread for a profile it does not use", async () => {
    const h = slackWorkerHarness({
      channelPair: async () => ({
        kind: "unavailable",
        profileName: "Fast review",
        detail: "AWS Bedrock is not connected",
      }),
      makeAcp: (base) => ({
        ...base,
        listSessions: async () => [
          {
            sessionId: "s-thread",
            platform: { threadTs: slackThreadKey("C1", "1.1") },
          },
        ],
      }),
    });
    await h.worker.connect();
    await h.gw.fireMention({
      user: "U1",
      channel: "C1",
      ts: "1.1",
      text: "and one more thing",
      teamId: "T-e2e",
    });
    const resumed = h.gw.readOutbound().filter((r) => r.kind === "message");
    expect(resumed.some((m) => JSON.stringify(m).includes("Fast review"))).toBe(
      false,
    );
    expect(h.prompts).toHaveLength(1);
  });

  /** TEST_SCENARIO: a fresh Slack thread on such a profile is refused, and the
   * channel is told why. */
  it("refuses a fresh Slack thread on a profile that cannot run", async () => {
    const h = slackWorkerHarness({
      channelPair: async () => ({
        kind: "unavailable",
        profileName: "Fast review",
        detail: "AWS Bedrock is not connected",
      }),
    });
    await h.worker.connect();
    await h.gw.fireMention({
      user: "U1",
      channel: "C1",
      ts: "2.2",
      text: "hello",
      teamId: "T-e2e",
    });
    const posted = h.gw.readOutbound().filter((r) => r.kind === "message");
    expect(posted.some((m) => JSON.stringify(m).includes("Fast review"))).toBe(
      true,
    );
    expect(h.prompts).toHaveLength(0);
  });

  /** TEST_SCENARIO: an ambient Slack session is a fresh session too, so it
   * starts on the channel's profile rather than on the agent's default. */
  it("starts an ambient Slack session on the channel's profile", async () => {
    const h = slackWorkerHarness({
      ambient: true,
      channelPair: async () => ({ kind: "profile", pair: PAIR }),
    });
    await h.worker.connect();
    await h.gw.fireMessage({
      user: "U1",
      channel: "C1",
      ts: "3.3",
      text: "a note for the channel",
      teamId: "T-e2e",
    });
    await h.settled(() => h.created.length > 0);
    expect(h.created[0]?.platform).toMatchObject({
      harness: PAIR.harness,
      model: PAIR.model,
    });
  });

  /** TEST_SCENARIO: a chat bound before profiles names none, so the turn sends no
   * pair and the agent's own default applies as it always did. */
  it("sends no pair for a chat that names no profile", async () => {
    const h = await started(
      telegramWorkerHarness({ channelPair: async () => ({ kind: "none" }) }),
    );
    h.sendDirect(JANE, "hello");
    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    const [sent] = h.prompts as (typeof h.prompts)[number][];
    const meta =
      sent !== undefined && "platformMeta" in sent.opts
        ? sent.opts.platformMeta
        : undefined;
    expect(meta?.harness).toBeUndefined();
    expect(meta?.model).toBeUndefined();
  });
});
