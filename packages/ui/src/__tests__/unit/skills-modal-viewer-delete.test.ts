// @vitest-environment happy-dom
// TEST_OVERVIEW: The preview of a skill made in the Agent offers Delete skill only to someone who may change the Agent's skills: the + menu's dialog leaves Delete out for a viewer, and the settings' Skills section, which passes it, keeps it.
import type { LocalSkill } from "api-server-api";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../modules/sandboxes/components/skills/local-skill-render-modal.js",
  () => ({
    LocalSkillRenderModal: (props: { footer?: ReactNode }) =>
      createElement("div", { "data-testid": "preview" }, props.footer),
  }),
);

const { SkillsModals } =
  await import("../../modules/sandboxes/components/skills/skills-modals.js");

const skill = {
  name: "my-notes",
  description: "",
  origin: "user",
} as LocalSkill;

const render = (onDeleteLocal?: () => void) =>
  renderToStaticMarkup(
    createElement(SkillsModals, {
      open: { kind: "render-local", skill },
      agentId: "a1",
      surface: { publishes: [], downloadStandalone: async () => {} } as never,
      derived: { publishableSources: [] } as never,
      onDeleteLocal,
      onClose: () => {},
    }),
  );

describe("a skill's preview", () => {
  // TEST_SCENARIO: with no delete handler, as the + menu passes for a viewer, the preview has no Delete skill.
  it("leaves out Delete for a viewer", () => {
    expect(render()).not.toContain("Delete skill");
  });

  // TEST_SCENARIO: with a delete handler, the preview offers Delete skill.
  it("offers Delete to someone who may change skills", () => {
    expect(render(() => {})).toContain("Delete skill");
  });
});
