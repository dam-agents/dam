// TEST_OVERVIEW: The model configuration the pickers open on: its two headings, the rows a profile that cannot run here keeps, the one action that fixes each, the custom row's counts, and the subagent toggle.
import type { ProfileWithUsage } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ProfileList,
  SubagentSection,
} from "../../modules/profiles/components/profile-list.js";

const profile = (
  overrides: Partial<ProfileWithUsage> = {},
): ProfileWithUsage => ({
  id: "p1",
  name: "Fast review",
  harness: "claude-code",
  providerTemplate: "anthropic",
  model: "anthropic/claude-mythos-5-1",
  settings: {},
  seeded: false,
  createdAt: "",
  updatedAt: "",
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: false },
  ...overrides,
});

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);

describe("the model configuration", () => {
  /** TEST_SCENARIO: two sections of the same weight, and a custom row that says
   * what it costs while it is not the active choice. */
  it("names both sections and what Custom selection costs", () => {
    const html = render(
      createElement(ProfileList, {
        profiles: [profile()],
        current: null,
        counts: { harnesses: 2, models: 9 },
        onPick: () => {},
        onCustom: () => {},
        onAttach: () => {},
        onManage: () => {},
      }),
    );
    expect(html).toContain("Model configuration");
    expect(html).toContain("Primary model");
    expect(html).toContain("Custom selection");
    expect(html).toContain("2 harnesses, 9 models");
  });

  /** TEST_SCENARIO: an unavailable profile keeps its place, disabled and never
   * crossed through, and offers the action its reason allows. */
  it("offers the one action each unavailable reason allows", () => {
    const notConnected = renderToStaticMarkup(
      createElement(ProfileList, {
        profiles: [
          profile({
            availability: {
              available: false,
              reason: "AWS Bedrock is not connected",
              attachable: false,
            },
          }),
        ],
        current: null,
        counts: { harnesses: 1, models: 1 },
        onPick: () => {},
        onCustom: () => {},
        onAttach: () => {},
        onManage: () => {},
      }),
    );
    expect(notConnected).toContain("Configure providers");
    expect(notConnected).not.toContain("Connect this provider");
    expect(notConnected).not.toContain("line-through");
    expect(notConnected).toContain("disabled");

    const attachable = renderToStaticMarkup(
      createElement(ProfileList, {
        profiles: [
          profile({
            availability: {
              available: false,
              reason: "Bob Shell is not attached to this agent",
              attachable: true,
            },
          }),
        ],
        current: null,
        counts: { harnesses: 1, models: 1 },
        onPick: () => {},
        onCustom: () => {},
        onAttach: () => {},
        onManage: () => {},
      }),
    );
    expect(attachable).toContain("Connect this provider");
  });

  /** TEST_SCENARIO: a profile the owner holds a provider for that the agent has
   * not been granted reads as available but offers the same one-click repair,
   * which is the case the action exists for (QA D3). */
  it("offers Connect this provider for an available but unattached profile", () => {
    const html = render(
      createElement(ProfileList, {
        profiles: [
          profile({
            availability: {
              available: true,
              reason: null,
              attachable: true,
            },
          }),
        ],
        current: null,
        counts: { harnesses: 1, models: 1 },
        onPick: () => {},
        onCustom: () => {},
        onAttach: () => {},
        onManage: () => {},
      }),
    );
    expect(html).toContain("Connect this provider");
    expect(html).toContain("Connect its provider to run it here");
    expect(html).not.toContain("aria-disabled");
  });

  /** TEST_SCENARIO: the subagent toggle is on by default, and off reveals the
   * same rows the primary model offers. */
  it("shows the subagent list only once the agent is not picking", () => {
    const on = render(
      createElement(SubagentSection, {
        profiles: [profile()],
        selectedId: null,
        onAgentPicks: () => {},
        onPick: () => {},
        onAttach: () => {},
        onManage: () => {},
      }),
    );
    expect(on).toContain("Subagent model");
    expect(on).toContain("Let the agent pick");
    expect(on).toContain("checked");
    expect(on).not.toContain("Fast review");

    const off = render(
      createElement(SubagentSection, {
        profiles: [profile()],
        selectedId: "p1",
        onAgentPicks: () => {},
        onPick: () => {},
        onAttach: () => {},
        onManage: () => {},
      }),
    );
    expect(off).toContain("Fast review");
  });
});
