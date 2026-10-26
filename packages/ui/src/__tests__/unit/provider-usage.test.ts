// TEST_OVERVIEW: What detaching a provider from an agent says stops: the agent's own defaults and schedules on it, and only the profiles this agent's chat default, subagent slot, channels or schedules name, never one another agent uses (QA R7).
import type { ProfileWithUsage } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { useProviderUsage } from "../../modules/sessions/hooks/use-provider-usage.js";

const profile = (id: string, name: string): ProfileWithUsage => ({
  id,
  name,
  harness: "claude-code",
  providerTemplate: "bedrock",
  model: "bedrock/opus",
  settings: {},
  newAgentDefault: false,
  usage: { agents: 1, channels: 0, schedules: 0 },
  availability: null,
});

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useSessionDefaults: () => ({
    data: {
      chat: { harness: "claude-code", provider: null, model: "bedrock/opus" },
      channel: null,
      scheduled: null,
      chatProfileId: "mine",
    },
  }),
}));

vi.mock("../../modules/schedules/api/queries.js", () => ({
  useSchedules: () => ({
    data: [{ name: "Nightly", model: null, profile: "scheduled" }],
  }),
}));

vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({
    data: [
      profile("mine", "Mine"),
      profile("scheduled", "Nightly profile"),
      profile("others", "Another agent's"),
    ],
  }),
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => ({ channels: [] }),
}));

function Usage() {
  const usage = useProviderUsage("agent-1")({
    id: "conn-bedrock",
    name: "AWS Bedrock",
    type: "bedrock",
    templateId: "bedrock",
  });
  return createElement("output", null, JSON.stringify(usage));
}

/** TEST_SCENARIO: a profile in use elsewhere, on this provider, is left out of this agent's warning; the agent's own chat profile and its schedule's profile are named. */
it("names only the profiles this agent runs on", () => {
  const html = renderToStaticMarkup(createElement(Usage));
  const usage = JSON.parse(
    html.replace(/^<output>|<\/output>$/g, "").replace(/&quot;/g, '"'),
  ) as { profiles: string[]; kinds: string[] };
  expect(usage.profiles).toEqual(["Mine", "Nightly profile"]);
  expect(usage.kinds).toEqual(["chat"]);
});
