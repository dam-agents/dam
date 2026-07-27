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
    describeUsers: vi.fn(async () => ({ users: [] })),
  };
}

function fakeTelegramWorker(): TelegramWorker {
  return {
    type: ChannelType.Telegram,
    start: vi.fn(async () => {}),
    stopAll: vi.fn(async () => {}),
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

    // Regression: Slack used to connect lazily on the first bind/post, so on a
    // fresh install with no bindings the socket never opened and inbound
    // commands, mentions and DMs were dropped. Both bots must be up at boot.
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
