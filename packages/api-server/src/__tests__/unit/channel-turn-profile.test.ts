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
import { createChannelProviderOutage } from "../../modules/channels/infrastructure/provider-outage-copy.js";
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

/* UNIT_BOUNDARY_DESCRIPTION: a binding row in the chat default's two slots, read through the real query; `resolved` answers each profile it names. */
function channelRow(
  profileId: string | null,
  resolved: ResolvedProfile | null | ((id: string) => ResolvedProfile | null),
  subagent: {
    platformSubagentProfileId?: string;
    platformSubagentSettings?: Record<string, string>;
  } = {},
) {
  const db = drizzle(async () => ({
    rows: [
      [
        profileId,
        null,
        subagent.platformSubagentProfileId ?? null,
        subagent.platformSubagentSettings ?? null,
      ],
    ],
  })) as unknown as Db;
  return createChannelProfiles(db, async ({ profileId: id }) =>
    typeof resolved === "function" ? resolved(id) : resolved,
  ).pair("agent-1", {
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

  /** TEST_SCENARIO: a channel's turn runs on both slots, as a chat start does: the primary profile's pair with the subagent profile's harness and model, or the subagent values the channel keeps; a subagent profile that cannot run leaves the subagent to the agent. */
  it("runs on both slots of the channel's pick", async () => {
    const profile = (name: string, pair: SessionPair): ResolvedProfile => ({
      profile: { name } as ResolvedProfile["profile"],
      pair,
      unavailable: null,
      attachable: false,
    });
    const haiku = { harness: "pi", provider: "conn-2", model: "cb/haiku" };
    await expect(
      channelRow(
        "p-primary",
        (id) =>
          id === "p-primary"
            ? profile("Primary", PAIR)
            : profile("Subagent", haiku),
        { platformSubagentProfileId: "p-subagent" },
      ),
    ).resolves.toEqual({
      ...PAIR,
      settings: {
        "platformSubagent.harness": "pi",
        "platformSubagent.model": "cb/haiku",
      },
    });
    const own = {
      "platformSubagent.harness": "codex",
      "platformSubagent.model": "openai/gpt-6.1-sol",
    };
    await expect(
      channelRow("p-primary", profile("Primary", PAIR), {
        platformSubagentSettings: own,
      }),
    ).resolves.toEqual({ ...PAIR, settings: own });
    await expect(
      channelRow(
        "p-primary",
        (id) =>
          id === "p-primary"
            ? profile("Primary", PAIR)
            : { ...profile("Subagent", haiku), unavailable: "not connected" },
        { platformSubagentProfileId: "p-subagent" },
      ),
    ).resolves.toEqual(PAIR);
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

describe("the outage a channel's failed turn names", () => {
  /** TEST_SCENARIO: a channel on its own profile, whose provider is down, names that provider's outage rather than the agent's channel default's; a channel bound before profiles, with no pick of its own, names the default's. */
  it("reads the channel's own pick before the agent's default", async () => {
    const onProfile: SessionPair = {
      harness: "claude-code",
      provider: "conn-anthropic",
      model: "anthropic/claude-sonnet",
    };
    const agentDefault: SessionPair = {
      harness: "claude-code",
      provider: "conn-bedrock",
      model: "bedrock/claude-sonnet",
    };
    const outage = createChannelProviderOutage({
      channelPair: async (_agentId, channel) =>
        channel.id === "C-PROFILE" ? onProfile : null,
      defaultPair: async () => agentDefault,
      templateOf: async (_agentId, connectionId) =>
        connectionId === "conn-anthropic" ? "anthropic" : "bedrock",
      status: async () => ({
        damSide: null,
        checkedAt: null,
        outages: [
          {
            templateId: "anthropic",
            reason: "failing-calls",
            since: "2026-10-27T10:00:00Z",
            statusPageUrl: null,
          },
        ],
      }),
    });
    expect(
      (await outage("agent-1", { type: "slack", id: "C-PROFILE" }))?.templateId,
    ).toBe("anthropic");
    expect(
      (await outage("agent-1", { type: "slack", id: "C-LEGACY" }))?.templateId,
    ).toBe("bedrock");
  });
});
