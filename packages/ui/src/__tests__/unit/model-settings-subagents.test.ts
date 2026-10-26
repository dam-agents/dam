import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: {
      catalog: {
        options: [
          {
            id: "effort",
            name: "Effort",
            category: "thought_level",
            choices: [{ value: "medium", name: "Medium" }],
          },
          {
            id: "subagentEffort",
            name: "Subagent effort",
            category: "thought_level",
            subagents: true,
            choices: [{ value: "medium", name: "Medium" }],
          },
        ],
      },
    },
  }),
  useResolvedHarnessConfig: () => ({
    values: null,
    origin: "none",
    modelsPaired: false,
  }),
}));
import { ModelSettingsPanel } from "../../modules/sessions/components/model-settings-panel.js";

// TEST_SCENARIO: the 0.2.24 Codex catalogue carries a subagent-only setting the old file-config control cannot apply, since the runtime skips options its config does not map. The restored panel shows the 0.2.23 choices, so the subagent group must not appear.
test("the restored panel shows no subagent-only setting", () => {
  const html = renderToStaticMarkup(
    createElement(ModelSettingsPanel, {
      agentId: "codex-agent",
      draft: { valueOf: () => null, set: () => {} },
    }),
  );
  expect(html).toContain("Effort");
  expect(html).not.toContain("Subagent effort");
});
