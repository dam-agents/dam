import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  status: { catalog: { options: [] as unknown[] } },
}));
vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({ data: h.status }),
  useResolvedHarnessConfig: () => ({
    values: null,
    origin: "none",
    modelsPaired: false,
  }),
}));
import { ModelSettingsPanel } from "../../modules/sessions/components/model-settings-panel.js";

const render = (model: string | null) =>
  renderToStaticMarkup(
    createElement(ModelSettingsPanel, {
      agentId: "codex-agent",
      draft: { valueOf: () => model, set: () => {} },
    }),
  );

// TEST_SCENARIO: the retained Codex config names no model, so its catalogue has no Model group while the release starts a chat from the saved pair. The restored panel must offer the Model field anyway, or the owner cannot set or correct the default a run needs.
test("a routed agent shows the model field even with no model group", () => {
  h.status = {
    catalog: {
      options: [
        {
          id: "effort",
          name: "Effort",
          category: "thought_level",
          choices: [{ value: "medium", name: "Medium" }],
        },
      ],
    },
  };
  const html = render("gpt-6.1-sol");
  expect(html).toContain('aria-label="Model"');
  expect(html).toContain("gpt-6.1-sol");
  expect(html).toContain("Effort");
});

// TEST_SCENARIO: a sleeping agent answers with no catalogue at all, but its saved pair still names a model; the field appears so the owner can see and change it.
test("a saved model shows with an empty catalogue", () => {
  h.status = { catalog: { options: [] } };
  expect(render("gpt-6.1-sol")).toContain('aria-label="Model"');
});

// TEST_SCENARIO: an agent whose harness offers neither a setting nor a saved default gains no empty controls.
test("a harness with nothing to set shows no panel", () => {
  h.status = { catalog: { options: [] } };
  expect(render(null)).toBe("");
});
