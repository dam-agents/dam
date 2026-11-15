// TEST_OVERVIEW: An agent's Channels page offers what it can act on. With no channel, it shows no Whispers card and no model for channel turns, since runs follow the agent's own model; one Slack channel brings both, the switch under the channel list. A Telegram-only agent gets the model picker and no Slack whisper switch.
import { AGENT_PERMISSIONS } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type * as HarnessConfig from "../../modules/agents/api/harness-config.js";
import type * as AgentQueries from "../../modules/agents/api/queries.js";
import type * as ProfileQueries from "../../modules/profiles/api/queries.js";
import type { AgentView } from "../../types.js";

vi.stubGlobal("window", new EventTarget());

const OWNS = [...AGENT_PERMISSIONS];

const state = vi.hoisted(() => ({
  channels: [] as { type: string; slackChannelId: string }[],
  telegramChats: 0,
  telegramAvailable: false,
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      showConfirm: vi.fn(),
      navigateToSandboxHome: vi.fn(),
    }),
}));
vi.mock("../../modules/agents/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AgentQueries>()),
  findAgent: () =>
    ({
      id: "agent-dev",
      name: "calm-harbor",
      whisper: true,
      channels: state.channels,
      access: { role: "owner", editors: [], permissions: OWNS },
    }) as unknown as AgentView,
  useAgents: () => ({
    data: {
      list: [],
      shared: [],
      availableChannels: {
        slack: true,
        telegram: state.telegramAvailable,
      },
    },
  }),
}));
vi.mock("../../modules/agents/api/mutations.js", () => ({
  useSetWhisper: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnectSlack: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/telegram/api/queries.js", () => ({
  useTelegramChats: () => ({
    data: {
      chats: Array.from({ length: state.telegramChats }, (_, i) => ({
        conversationId: `chat-${i}`,
        title: "qa-telegram",
        agentId: "agent-dev",
      })),
    },
  }),
  useTelegramBot: () => ({ data: undefined }),
}));
vi.mock("../../modules/telegram/api/mutations.js", () => ({
  useUnbindTelegramChat: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../modules/links/api/queries.js", () => ({
  useLinks: () => ({ data: {} }),
  useSlackInstallRequestUrl: () => null,
  useComputeRequestUrl: () => null,
  useDocsUrl: () => null,
}));
vi.mock("../../modules/sandboxes/api/channel-profile.js", () => ({
  useSetChannelChoice: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock(
  "../../modules/agents/api/harness-config.js",
  async (importOriginal) => ({
    ...(await importOriginal<typeof HarnessConfig>()),
    useHarnessConfigStatus: () => ({ data: undefined }),
  }),
);
vi.mock("../../modules/profiles/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ProfileQueries>()),
  useProfiles: () => ({ data: [] }),
}));
vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({
  SessionPairPicker: () => null,
}));
vi.mock("../../modules/sandboxes/components/agent-model-picker.js", () => ({
  AgentModelPicker: () => createElement("p", null, "CHANNEL-MODEL-PICKER"),
}));

const { SandboxChannelsSection } =
  await import("../../modules/sandboxes/components/sandbox-channels-section.js");

const render = () =>
  renderToStaticMarkup(
    createElement(SandboxChannelsSection, { agentId: "agent-dev" }),
  );

const slack = { type: "slack", slackChannelId: "C0123" };

describe("an agent's Channels page", () => {
  // TEST_SCENARIO: an agent nobody bound a channel to has nothing to whisper in and no channel turns to pick a model for, so both wait for the first channel.
  it("offers neither the whisper switch nor a channel model before the first channel", () => {
    state.channels = [];
    state.telegramChats = 0;
    state.telegramAvailable = false;
    const page = render();
    expect(page).not.toContain("Whispers");
    expect(page).not.toContain("CHANNEL-MODEL-PICKER");
  });

  // TEST_SCENARIO: one Slack channel makes whispers possible and channel turns real, and the switch belongs under the list it applies to, not above it.
  it("offers both once a Slack channel exists, the switch under the list", () => {
    state.channels = [slack];
    state.telegramChats = 0;
    state.telegramAvailable = false;
    const page = render();
    expect(page).toContain("C0123");
    expect(page).toContain("Whispers");
    expect(page).toContain("CHANNEL-MODEL-PICKER");
    expect(page.indexOf("Whispers")).toBeGreaterThan(page.indexOf("C0123"));
  });

  // TEST_SCENARIO: whispers are Slack-only, so a Telegram chat brings the channel model picker without the Slack switch.
  it("offers the channel model for a Telegram chat and no whisper switch", () => {
    state.channels = [];
    state.telegramChats = 1;
    state.telegramAvailable = true;
    const page = render();
    expect(page).toContain("CHANNEL-MODEL-PICKER");
    expect(page).not.toContain("Whispers");
  });
});
