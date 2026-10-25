// TEST_OVERVIEW: A channel runs on a profile of its own: what a new channel's bind dialog starts on, and the control on the row that changes it, which reads a legacy channel as the agent's chat default.
import type { ProfileWithUsage } from "api-server-api";
import { createElement, Fragment, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultProfileId,
  newestFirst,
  newestProfileId,
} from "../../modules/profiles/lib/default-profile.js";
import { ChannelProfileLine } from "../../modules/sandboxes/components/channels/channel-profile-line.js";

const state = vi.hoisted(() => ({
  profiles: [] as ProfileWithUsage[],
  setProfile: vi.fn(),
  attach: vi.fn(async () => true),
}));

vi.mock("@/components/ui/popover", () => {
  const passthrough = ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children);
  return {
    Popover: passthrough,
    PopoverTrigger: passthrough,
    PopoverContent: passthrough,
  };
});

vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({ data: state.profiles }),
}));

vi.mock("../../modules/sandboxes/api/channel-profile.js", () => ({
  useSetChannelProfile: () => ({ mutate: state.setProfile, isPending: false }),
}));

vi.mock("../../modules/profiles/hooks/use-profile-attach.js", () => ({
  useProfileAttach: () => ({ attach: state.attach, manage: vi.fn() }),
}));

const profile = (
  overrides: Partial<ProfileWithUsage> = {},
): ProfileWithUsage => ({
  id: "p1",
  name: "Default",
  harness: "claude-code",
  providerTemplate: "curve-bender-deployment",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  settings: {},
  seeded: true,
  createdAt: "",
  updatedAt: "",
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: false },
  ...overrides,
});

beforeEach(() => {
  state.profiles = [];
  state.setProfile.mockReset();
  state.attach.mockReset().mockResolvedValue(true);
});

describe("what a new channel starts on", () => {
  /** TEST_SCENARIO: the newest channel's profile, whichever kind of channel it is, beats the chat profile. */
  it("takes the newest channel's profile before the chat profile", () => {
    const profiles = [
      profile(),
      profile({ id: "p2", name: "Fast", seeded: false }),
    ];
    expect(
      defaultProfileId({
        profiles,
        newestProfileId: newestProfileId(
          newestFirst([
            { profileId: "p1", createdAt: "2026-10-01T00:00:00Z" },
            { profileId: "p2", createdAt: "2026-10-24T00:00:00Z" },
          ]),
        ),
        chatProfileId: "p1",
      }),
    ).toBe("p2");
  });

  /** TEST_SCENARIO: a channel that names nothing is passed over, so a legacy row does not decide what a new one runs on. */
  it("skips a newer channel that has no profile", () => {
    expect(
      newestProfileId(
        newestFirst([
          { profileId: "p1", createdAt: "2026-10-01T00:00:00Z" },
          { profileId: null, createdAt: "2026-10-24T00:00:00Z" },
        ]),
      ),
    ).toBe("p1");
  });

  /** TEST_SCENARIO: with no sibling to inherit from the chat profile is used, then the seeded Default — and a reference the owner no longer holds is never preselected. */
  it("falls back to the chat profile, then the seeded profile", () => {
    const profiles = [profile()];
    expect(
      defaultProfileId({
        profiles,
        newestProfileId: null,
        chatProfileId: "gone",
      }),
    ).toBe("p1");
    expect(
      defaultProfileId({
        profiles: [...profiles, profile({ id: "p2", name: "Fast" })],
        newestProfileId: null,
        chatProfileId: "p2",
      }),
    ).toBe("p2");
    expect(
      defaultProfileId({
        profiles: [],
        newestProfileId: null,
        chatProfileId: null,
      }),
    ).toBe(null);
  });
});

describe("the channel row's profile", () => {
  /** TEST_SCENARIO: a channel that names a profile shows its name; a legacy channel says it follows the agent's chat default. */
  it("names the profile the channel runs on", () => {
    state.profiles = [profile()];
    const bound = renderToStaticMarkup(
      createElement(ChannelProfileLine, {
        agentId: "a1",
        channel: { type: "slack", slackChannelId: "C1" },
        profileId: "p1",
      }),
    );
    expect(bound).toContain("Runs on");
    expect(bound).toContain("Default");

    const legacy = renderToStaticMarkup(
      createElement(ChannelProfileLine, {
        agentId: "a1",
        channel: { type: "telegram", conversationId: "t1" },
        profileId: null,
      }),
    );
    expect(legacy).toContain("the agent&#x27;s chat default");
  });

  /** TEST_SCENARIO: a reader who may not change the channel gets no control to pick with. */
  it("offers nothing when the channel is read-only", () => {
    state.profiles = [profile()];
    const html = renderToStaticMarkup(
      createElement(ChannelProfileLine, {
        agentId: "a1",
        channel: { type: "slack", slackChannelId: "C1" },
        profileId: null,
        readOnly: true,
      }),
    );
    expect(html).toContain("disabled");
  });
});
