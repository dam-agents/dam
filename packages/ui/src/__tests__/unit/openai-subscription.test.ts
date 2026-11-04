// TEST_OVERVIEW: Subscription setup asks for no API secret and tells the owner where the native login lives. Native model picks discard router-only settings while preserving the platform subagent choice and the session's normal effort.
import type { HarnessCapability } from "agent-runtime-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { OpenAIForm } from "../../modules/providers/components/openai/form.js";
import { withSubagent } from "../../modules/sessions/lib/subagent-choice.js";

describe("OpenAI subscription setup", () => {
  // TEST_SCENARIO: Subscription users authorize in a browser on each agent; they must not paste a key into a field or be sent to API billing.
  it("renders keyless setup and explicit per-agent authorization instructions", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(OpenAIForm, {
          variant: "wizard",
          initialMode: "chatgpt",
          onSave: async () => {},
        }),
      ),
    );
    expect(html).toContain("Enable ChatGPT subscription");
    expect(html).toContain("codex-chatgpt login --device-auth");
    expect(html).toContain("web chat and Slack");
    expect(html).toContain("model spend limits");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("https://platform.openai.com/api-keys");
  });

  // TEST_SCENARIO: One subagent pick still configures a separate platform subagent, but cannot silently claim it controls native Codex's internal subagent model.
  it("keeps the platform subagent without synthesizing router-only settings", () => {
    const capability: HarnessCapability = {
      name: "codex",
      harnessConfig: true,
      sessionModel: true,
      sessionSettings: ["subagentModel", "subagentEffort"],
      harnessConfigCatalog: {
        options: [
          {
            id: "subagentModel",
            name: "Subagent model",
            category: "model",
            choices: [],
            requiresRouter: true,
          },
          {
            id: "subagentEffort",
            name: "Subagent effort",
            category: "thought_level",
            subagents: true,
            choices: [{ value: "high", name: "High" }],
            requiresRouter: true,
          },
        ],
      },
    };
    const result = withSubagent(
      {
        harness: "codex",
        provider: "subscription",
        model: "openai/gpt-6.1-sol",
        settings: { effort: "high" },
      },
      {
        harness: "codex",
        model: "openai/gpt-6-luna",
        settings: { effort: "high" },
      },
      capability,
      [{ name: "openai/gpt-6.1-sol", native: true }],
    );
    expect(result.settings).toEqual({
      effort: "high",
      "platformSubagent.harness": "codex",
      "platformSubagent.model": "openai/gpt-6-luna",
      "platformSubagent.effort": "high",
    });
  });
});
