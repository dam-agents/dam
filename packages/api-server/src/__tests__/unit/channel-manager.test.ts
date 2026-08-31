import { describe, it, expect, vi } from "vitest";
import { ChannelType, type ChannelConfig } from "api-server-api";
import { createChannelManager } from "../../modules/channels/services/channel-manager.js";
import type { SlackWorker } from "../../modules/channels/infrastructure/slack.js";
import type { TelegramWorker } from "../../modules/channels/infrastructure/telegram.js";

function fakeSlackWorker(): SlackWorker {
  return {
    type: ChannelType.Slack,
    connect: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    stopAll: vi.fn(async () => {}),
    listConversations: vi.fn(async () => []),
    postMessage: vi.fn(async () => ({ ok: true as const })),
    reply: vi.fn(async () => ({ ok: true as const })),
    react: vi.fn(async () => ({ ok: true as const })),
    declineTurn: vi.fn(async () => ({ ok: true as const })),
    handOffTurn: vi.fn(async () => ({ ok: true as const, agent: "other" })),
    describeUsers: vi.fn(async () => ({ users: [] })),
    supportsUserLookup: vi.fn(async () => true),
    describeMessageReactions: vi.fn(async () => ({
      reactions: [],
      conversationId: "C1",
      messageTs: "1.1",
    })),
    supportsMessageReactions: vi.fn(async () => true),
  };
}

function fakeTelegramWorker(): TelegramWorker {
  return {
    type: ChannelType.Telegram,
    start: vi.fn(async () => {}),
    stopAll: vi.fn(async () => {}),
    resolveIdentity: vi.fn(async () => {}),
    botUsername: vi.fn(() => null),
    listConversations: vi.fn(async () => []),
    postMessage: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("channel-manager bootstrap", () => {
  it("opens the Slack socket on startup even with no bindings", async () => {
    const slackWorker = fakeSlackWorker();
    const telegramWorker = fakeTelegramWorker();
    const manager = createChannelManager({ slackWorker, telegramWorker });

    await manager.bootstrap(new Map());

    expect(slackWorker.connect).toHaveBeenCalledTimes(1);
    expect(telegramWorker.start).toHaveBeenCalledTimes(1);
    expect(slackWorker.start).not.toHaveBeenCalled();

    await manager.stopAll();
  });

  it("connects, then registers per-Agent workers for channels bound at boot", async () => {
    const slackWorker = fakeSlackWorker();
    const manager = createChannelManager({ slackWorker });

    const channel: ChannelConfig = {
      type: ChannelType.Slack,
      slackChannelId: "C123",
    };
    await manager.bootstrap(new Map([["agent-1", [channel]]]));

    expect(slackWorker.connect).toHaveBeenCalledTimes(1);
    expect(slackWorker.start).toHaveBeenCalledWith("agent-1", channel);

    await manager.stopAll();
  });

  it("boots cleanly when only Telegram is configured", async () => {
    const telegramWorker = fakeTelegramWorker();
    const manager = createChannelManager({ telegramWorker });

    await manager.bootstrap(new Map());

    expect(telegramWorker.start).toHaveBeenCalledTimes(1);

    await manager.stopAll();
  });

  it("keeps the lease and retries when the only transport fails", async () => {
    vi.useFakeTimers();
    const slackWorker = fakeSlackWorker();
    vi.mocked(slackWorker.connect)
      .mockRejectedValueOnce(new Error("slack is down"))
      .mockResolvedValueOnce(undefined);
    const manager = createChannelManager({ slackWorker });

    await expect(manager.bootstrap(new Map())).resolves.toBeUndefined();
    expect(slackWorker.connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(slackWorker.connect).toHaveBeenCalledTimes(2);

    await manager.stopAll();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(slackWorker.connect).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("serves the transports that came up when one fails", async () => {
    vi.useFakeTimers();
    const slackWorker = fakeSlackWorker();
    const telegramWorker = fakeTelegramWorker();
    vi.mocked(telegramWorker.start).mockRejectedValue(new Error("no telegram"));
    const manager = createChannelManager({ slackWorker, telegramWorker });

    const channel: ChannelConfig = {
      type: ChannelType.Slack,
      slackChannelId: "C123",
    };
    await manager.bootstrap(new Map([["agent-1", [channel]]]));

    expect(slackWorker.start).toHaveBeenCalledWith("agent-1", channel);

    await manager.stopAll();
    vi.useRealTimers();
  });
});

describe("channel-manager user lookup", () => {
  it("routes a lookup to the Slack worker", async () => {
    const slackWorker = fakeSlackWorker();
    const manager = createChannelManager({ slackWorker });

    await manager.describeUsers("agent-1", ChannelType.Slack, ["U1", "U2"]);

    expect(slackWorker.describeUsers).toHaveBeenCalledWith("agent-1", [
      "U1",
      "U2",
    ]);

    await manager.stopAll();
  });

  it("refuses on a channel whose worker has no directory", async () => {
    const telegramWorker = fakeTelegramWorker();
    const manager = createChannelManager({ telegramWorker });

    const result = await manager.describeUsers(
      "agent-1",
      ChannelType.Telegram,
      ["123456"],
    );

    expect(result).toEqual({
      error: "user lookup not supported on telegram",
    });

    await manager.stopAll();
  });
});

describe("channel-manager supportsUserLookup", () => {
  it("reflects the Slack worker's answer", async () => {
    const slackWorker = fakeSlackWorker();
    slackWorker.supportsUserLookup = vi.fn(async () => false);
    const manager = createChannelManager({ slackWorker });

    expect(await manager.supportsUserLookup()).toBe(false);

    await manager.stopAll();
  });

  it("fails open when Telegram is the only worker (no directory to begin with)", async () => {
    const telegramWorker = fakeTelegramWorker();
    const manager = createChannelManager({ telegramWorker });

    expect(await manager.supportsUserLookup()).toBe(true);

    await manager.stopAll();
  });

  it("fails open with no channel workers configured at all", async () => {
    const manager = createChannelManager({});

    expect(await manager.supportsUserLookup()).toBe(true);

    await manager.stopAll();
  });
});

describe("channel-manager message reactions", () => {
  it("routes a lookup to the Slack worker", async () => {
    const slackWorker = fakeSlackWorker();
    const manager = createChannelManager({ slackWorker });

    await manager.describeMessageReactions("agent-1", ChannelType.Slack, {
      messageTs: "1.1",
    });

    expect(slackWorker.describeMessageReactions).toHaveBeenCalledWith(
      "agent-1",
      { messageTs: "1.1" },
    );

    await manager.stopAll();
  });

  it("refuses on a channel whose worker has no reaction lookup", async () => {
    const telegramWorker = fakeTelegramWorker();
    const manager = createChannelManager({ telegramWorker });

    const result = await manager.describeMessageReactions(
      "agent-1",
      ChannelType.Telegram,
      { messageTs: "1.1" },
    );

    expect(result).toEqual({
      error: "message reactions not supported on telegram",
    });

    await manager.stopAll();
  });
});

describe("channel-manager supportsMessageReactions", () => {
  it("reflects the Slack worker's answer", async () => {
    const slackWorker = fakeSlackWorker();
    slackWorker.supportsMessageReactions = vi.fn(async () => false);
    const manager = createChannelManager({ slackWorker });

    expect(await manager.supportsMessageReactions()).toBe(false);

    await manager.stopAll();
  });

  it("fails open when Telegram is the only worker (nothing to ask to begin with)", async () => {
    const telegramWorker = fakeTelegramWorker();
    const manager = createChannelManager({ telegramWorker });

    expect(await manager.supportsMessageReactions()).toBe(true);

    await manager.stopAll();
  });

  it("fails open with no channel workers configured at all", async () => {
    const manager = createChannelManager({});

    expect(await manager.supportsMessageReactions()).toBe(true);

    await manager.stopAll();
  });
});
