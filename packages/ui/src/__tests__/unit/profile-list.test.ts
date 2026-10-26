// TEST_OVERVIEW: The profile rows every picker shows: the selected one is marked, and a profile that cannot run here stays listed, disabled, with its reason and the one action that fixes it inline.
import type { ProfileWithUsage } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProfileChoices } from "../../modules/profiles/components/profile-list.js";

vi.mock("../../modules/profiles/hooks/use-profile-attach.js", () => ({
  useProfileAttach: () => ({
    attach: async () => "conn-attached",
    manage: () => {},
  }),
}));

const profile = (
  overrides: Partial<ProfileWithUsage> = {},
): ProfileWithUsage => ({
  id: "p1",
  name: "Fast review",
  harness: "claude-code",
  providerTemplate: "anthropic",
  model: "anthropic/claude-mythos-5-1",
  settings: {},
  newAgentDefault: false,
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: false },
  ...overrides,
});

const rows = (profiles: ProfileWithUsage[], selectedId: string | null = null) =>
  renderToStaticMarkup(
    createElement(ProfileChoices, {
      profiles,
      selectedId,
      onPick: () => {},
      onAttach: () => {},
      onManage: () => {},
    }),
  );

describe("the profile rows", () => {
  /** TEST_SCENARIO: the selected profile is marked current. */
  it("marks the selected profile", () => {
    expect(rows([profile()], "p1")).toContain('aria-current="true"');
    expect(rows([profile()])).not.toContain("aria-current");
  });

  /** TEST_SCENARIO: a provider nobody connected offers the page that connects one; one the owner holds and the agent lacks offers the grant (QA D3). */
  it("offers the action each unavailable profile allows", () => {
    const notConnected = rows([
      profile({
        availability: {
          available: false,
          reason: "AWS Bedrock is not connected",
          attachable: false,
        },
      }),
    ]);
    expect(notConnected).toContain('disabled=""');
    expect(notConnected).toContain("AWS Bedrock is not connected");
    expect(notConnected).toContain("Configure providers");
    const attachable = rows([
      profile({
        availability: {
          available: true,
          reason: "Anthropic isn't attached to this agent",
          attachable: true,
        },
      }),
    ]);
    expect(attachable).toContain("Connect this provider");
    expect(attachable).not.toContain('disabled=""');
  });
});
