// TEST_OVERVIEW: What detaching a provider from an agent says stops: the agent's own defaults, schedules and interactive pages on it, and only the profiles this agent's chat default, subagent slot, channels, schedules or pages name, never one another agent uses (QA R7).
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
  subagent: null,
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

const schedule = (
  name: string,
  rest: { type?: string; enabled?: boolean; profile?: string; status?: object },
) => ({
  name,
  model: "bedrock/opus",
  profile: null,
  type: "cron",
  enabled: true,
  status: null,
  ...rest,
});

vi.mock("../../modules/schedules/api/queries.js", () => ({
  useSchedules: () => ({
    data: [
      schedule("Nightly", { profile: "scheduled" }),
      schedule("Turned off", { enabled: false, profile: "off" }),
      schedule("review-pr", { type: "once" }),
      schedule("review-pr", { type: "once" }),
      schedule("Ran once", {
        type: "once",
        status: { lastRun: "2026-11-01T00:00:00Z", lastResult: "success" },
      }),
    ],
  }),
}));

vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({
    data: [
      profile("mine", "Mine"),
      profile("scheduled", "Nightly profile"),
      profile("others", "Another agent's"),
      profile("off", "Turned-off schedule's"),
    ],
  }),
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => ({ channels: [] }),
}));

const pick = (pair: { provider: string; model: string } | null) => ({
  profileId: null,
  pair: pair && { harness: "claude-code", ...pair },
  platformSubagentProfileId: null,
  platformSubagentSettings: null,
});

vi.mock("../../modules/artifacts/api/queries.js", () => ({
  useAgentPromptChoices: () => ({
    data: [
      {
        id: "a1",
        title: "Desk",
        choice: pick({ provider: "conn-bedrock", model: "bedrock/opus" }),
      },
      {
        id: "a2",
        title: "Elsewhere",
        choice: pick({ provider: "conn-openai", model: "openai/gpt" }),
      },
    ],
  }),
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

/** TEST_SCENARIO: a profile in use elsewhere, or only by a schedule that is turned off, is left out of this agent's warning; the agent's own chat profile and its running schedule's profile are named. */
it("names only the profiles this agent runs on", () => {
  const html = renderToStaticMarkup(createElement(Usage));
  const usage = JSON.parse(
    html.replace(/^<output>|<\/output>$/g, "").replace(/&quot;/g, '"'),
  ) as { profiles: string[]; kinds: string[] };
  expect(usage.profiles).toEqual(["Mine", "Nightly profile"]);
  expect(usage.kinds).toEqual(["chat"]);
});

/** TEST_SCENARIO: a page whose own pick runs on the provider is named, so detaching it says the page's prompts stop; a page on another provider is not. */
it("names the pages whose own pick runs on the provider", () => {
  const html = renderToStaticMarkup(createElement(Usage));
  const usage = JSON.parse(
    html.replace(/^<output>|<\/output>$/g, "").replace(/&quot;/g, '"'),
  ) as { pages: string[] };
  expect(usage.pages).toEqual(["Desk"]);
});

/** TEST_SCENARIO: an agent with hundreds of one-off schedules (#6475): only those that turning the provider off stops are named, each name once; one that is turned off or already ran is left out. */
it("names each schedule that still runs, once", () => {
  const html = renderToStaticMarkup(createElement(Usage));
  const usage = JSON.parse(
    html.replace(/^<output>|<\/output>$/g, "").replace(/&quot;/g, '"'),
  ) as { schedules: string[] };
  expect(usage.schedules).toEqual(["Nightly", "review-pr"]);
});

/** TEST_SCENARIO: a turned-off schedule on the provider is not named, but counted, because turning it back on after the provider is gone runs it on nothing; a one-off that already ran is not counted. */
it("counts the turned-off schedules on the provider", () => {
  const html = renderToStaticMarkup(createElement(Usage));
  const usage = JSON.parse(
    html.replace(/^<output>|<\/output>$/g, "").replace(/&quot;/g, '"'),
  ) as { turnedOffSchedules: number };
  expect(usage.turnedOffSchedules).toBe(1);
});
