// TEST_OVERVIEW: Subscription runs retain platform subagents without deriving settings that only the model router implements, including when shared run boundaries settle chat, channel and schedule payloads.
import { describe, expect, it } from "vitest";
import type { OwnerModelCatalogView } from "api-server-api";
import {
  harnessCapabilityOf,
  loadShippedHarnessFacts,
} from "../../modules/connections/infrastructure/shipped-harness-manifests.js";
import { runSubagentSettings } from "../../modules/harness-config/domain/session-pair.js";
import { createRunBoundary } from "../../modules/harness-config/domain/run-boundary.js";

const capability = harnessCapabilityOf(loadShippedHarnessFacts().codex!);
const pair = {
  harness: "codex",
  provider: "subscription",
  model: "openai/gpt-6.1-sol",
};
const settings = {
  effort: "high",
  "platformSubagent.harness": "codex",
  "platformSubagent.model": "openai/gpt-6.1-sol",
  "platformSubagent.effort": "medium",
};
const catalog = (template: string): OwnerModelCatalogView => ({
  defaultHarness: "codex",
  modelRouter: true,
  harnesses: [capability],
  providers: [
    {
      connectionId: "subscription",
      alias: "openai",
      template,
      displayName: "OpenAI",
      status: "listed",
      listedAt: null,
      harnesses: ["codex"],
      models: [
        {
          name: pair.model,
          upstreamId: "gpt-6.1-sol",
          harnesses: ["codex"],
          contextWindow: null,
          maxOutputTokens: null,
          reasoning: null,
          vision: null,
          prices: null,
          source: { limits: "none", prices: "none" },
        },
      ],
    },
  ],
});

describe("subscription platform subagents", () => {
  // TEST_SCENARIO: Upstream derives internal subagent settings from platform slots. Native subscription inference must keep the slot without producing router-only overrides.
  it("keeps platform settings on native runs and derives router settings on API runs", () => {
    expect(
      runSubagentSettings(
        capability,
        catalog("openai-chatgpt"),
        pair,
        settings,
      ),
    ).toEqual(settings);
    expect(
      runSubagentSettings(capability, catalog("openai"), pair, settings),
    ).toEqual({
      ...settings,
      subagentModel: pair.model,
      subagentEffort: "medium",
    });
  });

  // TEST_SCENARIO: The shared run boundary builds payloads for web chat, Slack and schedules, so it must apply the same native authentication constraints as default validation.
  it("settles a native payload without router settings", async () => {
    const boundary = createRunBoundary({
      inputsOf: async () => ({
        capabilities: { harnesses: [capability] },
        catalog: catalog("openai-chatgpt"),
      }),
    });
    expect(await boundary.pair("agent", { ...pair, settings })).toEqual({
      ...pair,
      settings,
    });
  });
});
