// @vitest-environment happy-dom
// TEST_OVERVIEW: The composer + menu's Skills panel lists the same groups as the Agent's settings, as the design's flow spec orders them: the skills made in the Agent, the GitHub sources, then the skills the platform and the sandbox image ship, which carry no switch. So a skill a person saw in the panel while the Agent was still starting stays there once it runs. In the menu, a platform skill's feature badge opens nothing, so no settings dialog is drawn under the open menu.
import type { LocalSkill } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const openAgentSettings = vi.fn();
vi.mock("../../store.js", () => ({
  useStore: (pick: (s: unknown) => unknown) => pick({ openAgentSettings }),
}));
vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useResolvedHarnessConfig: () => ({ hasRun: true, pending: false }),
}));
vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake: () => {} }),
}));
vi.mock("../../modules/sandboxes/hooks/use-skills-surface.js", () => ({
  useSkillsSurface: () => ({ publishes: [], hiddenSources: [] }),
}));
vi.mock("../../modules/sandboxes/hooks/use-skills-confirms.js", () => ({
  useSkillsConfirms: () => ({}),
}));

const skill = (name: string, origin: LocalSkill["origin"]) =>
  ({ name, description: `${name} skill`, origin }) as LocalSkill;

vi.mock("../../modules/sandboxes/hooks/use-skills-derivations.js", () => ({
  useSkillsDerivations: () => ({
    searching: false,
    totals: { skills: 3, sources: 0, on: 3 },
    matchCount: null,
    shownCreatedHere: [skill("my-notes", "user")],
    shownPlatform: [skill("platform-schedules", "system")],
    shownBuiltIn: [skill("pdf-reader", "system")],
    publishableSources: [],
    previewReady: true,
    anyInstalled: false,
    drifted: [],
    trackTargets: new Map(),
  }),
}));
const stub = (testId: string) => () =>
  createElement("div", { "data-testid": testId });
vi.mock(
  "../../modules/sandboxes/components/skills/skill-sources-section.js",
  () => ({
    SkillSourcesSection: stub("sources"),
  }),
);
vi.mock(
  "../../modules/sandboxes/components/skills/standalone-skills-group.js",
  () => ({
    StandaloneSkillsGroup: stub("created-here"),
  }),
);
vi.mock("../../modules/sandboxes/components/skills/skills-modals.js", () => ({
  SkillsModals: () => null,
}));
vi.mock(
  "../../modules/sandboxes/components/skills/skills-search-header.js",
  () => ({
    SkillsSearchHeader: stub("search"),
  }),
);

const { SkillsSurface } =
  await import("../../modules/sandboxes/components/skills/skills-surface.js");

const render = (compact: boolean) =>
  renderToStaticMarkup(
    createElement(SkillsSurface, {
      agentId: "a1",
      agentState: "running",
      readOnly: false,
      managesLibrary: true,
      canPublish: false,
      compact,
      onOpenModal: () => {},
    }),
  );

describe("the + menu's Skills panel, on a running Agent", () => {
  // TEST_SCENARIO: the panel shows the skills from platform features and from the sandbox image after the Agent's own and its sources, as the settings page does.
  it("lists the platform's and the image's skills", () => {
    const html = render(true);
    expect(html).toContain("From platform features");
    expect(html).toContain("platform-schedules");
    expect(html).toContain("Included with sandbox image");
    expect(html).toContain("pdf-reader");
    expect(html.indexOf("created-here")).toBeLessThan(
      html.indexOf("From platform features"),
    );
    expect(html.indexOf("From platform features")).toBeLessThan(
      html.indexOf("Included with sandbox image"),
    );
  });

  // TEST_SCENARIO: in the menu a feature badge is a plain label; on the settings page it is a button that opens the feature's section.
  it("keeps the feature badge a plain label in the menu", () => {
    expect(render(true)).not.toContain('title="Open Schedules"');
    expect(render(false)).toContain('title="Open Schedules"');
  });
});
