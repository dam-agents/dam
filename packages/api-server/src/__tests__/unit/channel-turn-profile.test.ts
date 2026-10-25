// TEST_OVERVIEW: What a channel's turn starts on. A fresh session in a channel names the pair the channel's profile resolves to, so it starts there and not on the agent's default; a channel that predates profiles sends nothing and keeps the chain it had; a profile that cannot run on the agent stops the turn with its reason in the thread, instead of running on another model.
import type { SessionPair } from "api-server-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelegramUser } from "@chat-adapter/telegram";
import { configureLogger } from "../../core/logger.js";
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
      telegramWorkerHarness({ channelPair: async () => PAIR }),
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

  /** TEST_SCENARIO: a chat bound before profiles names none, so the turn sends no
   * pair and the agent's own default applies as it always did. */
  it("sends no pair for a chat that names no profile", async () => {
    const h = await started(
      telegramWorkerHarness({ channelPair: async () => null }),
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
