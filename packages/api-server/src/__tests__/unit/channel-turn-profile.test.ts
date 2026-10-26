// TEST_OVERVIEW: What a channel's turn starts on (D91, D119). A fresh session in a channel is created on the pair the channel's profile resolves to, a profile that cannot run stops the turn with its reason in the thread instead of running on another model, and a thread that is already running keeps the values it has.
import { slackThreadKey, type SessionPair } from "api-server-api";
import { drizzle } from "drizzle-orm/pg-proxy";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelegramUser } from "@chat-adapter/telegram";
import type { Db } from "db";
import { configureLogger } from "../../core/logger.js";
import {
  ChannelProfileRefusedError,
  createChannelProfiles,
} from "../../modules/channels/infrastructure/channel-profile.js";
import type { ResolvedProfile } from "../../modules/profiles/index.js";
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

const refused = async (): Promise<never> => {
  throw new ChannelProfileRefusedError(
    "Fast review",
    "AWS Bedrock is not connected",
  );
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

function channelRow(
  profileId: string | null,
  resolved: ResolvedProfile | null,
) {
  const db = drizzle(async () => ({ rows: [[profileId]] })) as unknown as Db;
  return createChannelProfiles(db, async () => resolved).pair("agent-1", {
    type: "slack",
    id: "C1",
  });
}

describe("a channel's turn", () => {
  /** TEST_SCENARIO: the row's profile resolves to a pair, and a profile that cannot run is a refusal, never the agent's default in its place. */
  it("resolves the row's profile, and refuses one that cannot run", async () => {
    const profile = { name: "Fast review" } as ResolvedProfile["profile"];
    await expect(
      channelRow("p1", {
        profile,
        pair: PAIR,
        unavailable: null,
        attachable: false,
      }),
    ).resolves.toEqual(PAIR);
    await expect(
      channelRow("p1", {
        profile,
        pair: PAIR,
        unavailable: "CurveBender isn't attached to this agent",
        attachable: true,
      }),
    ).rejects.toThrow(ChannelProfileRefusedError);
    await expect(channelRow(null, null)).resolves.toBeNull();
  });

  /** TEST_SCENARIO: the channel names a profile, so the fresh session is created on that profile's pair rather than on whatever the agent defaults to. */
  it("starts a fresh session on the channel's profile", async () => {
    const h = await started(
      telegramWorkerHarness({ channelPair: async () => PAIR }),
    );
    h.sendDirect(JANE, "hello");
    await vi.waitFor(() => expect(h.prompts).toHaveLength(1));
    expect(h.prompts[0]?.opts).toMatchObject({
      platformMeta: { harness: PAIR.harness, model: PAIR.model },
    });
  });

  /** TEST_SCENARIO: a profile that cannot run stops the turn and the chat is told why. */
  it("refuses a profile that cannot run, and says why in the chat", async () => {
    const h = await started(telegramWorkerHarness({ channelPair: refused }));
    h.sendDirect(JANE, "hello");
    await vi.waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.posts[0]).toContain("AWS Bedrock is not connected");
    expect(h.prompts).toHaveLength(0);
  });

  /** TEST_SCENARIO: a running Slack thread keeps its values, so a profile that has since become unusable does not refuse it (D94 A, D119). */
  it("does not refuse a resumed Slack thread", async () => {
    const h = slackWorkerHarness({
      channelPair: refused,
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
    expect(h.prompts).toHaveLength(1);
  });

  /** TEST_SCENARIO: an ambient Slack session is a fresh session too. */
  it("starts an ambient Slack session on the channel's profile", async () => {
    const h = slackWorkerHarness({
      ambient: true,
      channelPair: async () => PAIR,
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
});
