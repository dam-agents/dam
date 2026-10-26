// TEST_OVERVIEW: One summary reads a pick under the chat input, on the Custom selection row and in Settings › Profiles: the pretty model name, the capitalized effort and the provider, each left out when it does not exist.
import type { HarnessCapability } from "agent-runtime-api";
import { expect, it } from "vitest";

import { pairSummary } from "../../modules/sessions/lib/session-settings.js";

const claude: HarnessCapability = {
  name: "claude-code",
  harnessConfig: true,
  sessionModel: true,
  sessionSettings: ["effort", "subagentEffort"],
  harnessConfigCatalog: {
    options: [
      {
        id: "subagentEffort",
        name: "Subagent effort",
        category: "thought_level",
        subagents: true,
        choices: [{ value: "low", name: "low" }],
      },
      {
        id: "effort",
        name: "Effort",
        category: "thought_level",
        default: "medium",
        choices: [
          { value: "medium", name: "medium" },
          { value: "high", name: "high" },
        ],
      },
    ],
    modelConstraints: { "claude-haiku-4-5": { effort: [] } },
  },
};

/** TEST_SCENARIO: Each part shows when it exists, and is dropped with its separator when it does not. */
it.each<{
  model: string | null;
  capability: HarnessCapability | undefined;
  settings: Record<string, string>;
  provider: string | null;
  expected: string;
}>([
  {
    model: "ete/claude-sonnet-5-5",
    capability: claude,
    settings: { effort: "high", subagentEffort: "low" },
    provider: "IBM ETE LiteLLM Proxy",
    expected: "Claude Sonnet 5.5 · High (IBM ETE LiteLLM Proxy)",
  },
  {
    model: "ete/claude-sonnet-5-5",
    capability: claude,
    settings: {},
    provider: null,
    expected: "Claude Sonnet 5.5 · Medium",
  },
  {
    model: "ete/claude-haiku-4-5",
    capability: claude,
    settings: { effort: "high" },
    provider: "ETE",
    expected: "Claude Haiku 4.5 (ETE)",
  },
  {
    model: "cb/vendor/unknown-model",
    capability: undefined,
    settings: { effort: "high" },
    provider: "Curve",
    expected: "vendor/unknown-model (Curve)",
  },
  {
    model: null,
    capability: claude,
    settings: {},
    provider: "Curve",
    expected: "Choose a model",
  },
])("reads $expected", ({ model, capability, settings, provider, expected }) => {
  expect(pairSummary(model, { capability, settings, provider })).toBe(expected);
});
