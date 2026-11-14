// @vitest-environment happy-dom
// TEST_OVERVIEW: In the Agent's settings modal, as the design draws it, the section list fills the left column, two lines a row, and scrolls up and down on its own when it does not fit, never sideways; the open section scrolls beside it with room for its bar. The Agent's editable name and avatar are no longer above the list: they head the General section. The scrolling column holds its own side padding and keeps room for its bar, so the bar never sits on the content. On the configuration page the nav keeps its sticky place in the page's own scroll.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

vi.mock("../../modules/a2ui/hooks/use-chat-forms-enabled.js", () => ({
  useChatFormsEnabled: () => true,
}));
vi.mock("../../modules/environments/api/queries.js", () => ({
  useEnvironmentsEnabled: () => false,
  useEnvironments: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("../../modules/sandboxes/hooks/use-section-summaries.js", () => ({
  useSectionSummaries: () => ({ summaries: {}, warnings: {} }),
}));
vi.mock("../../modules/processes/api/queries.js", () => ({
  useProcesses: () => ({ data: undefined }),
}));
vi.mock("../../modules/processes/components/pending-restart-banner.js", () => ({
  useApplyPendingRestartWithConfirm: () => ({ apply: vi.fn() }),
}));
vi.mock("../../modules/sandboxes/components/sandbox-home-header.js", () => ({
  SandboxHomeHeader: () => createElement("h1", null, "SECTION-HEADER"),
  SandboxIdentity: () => createElement("h2", null, "AGENT-NAME"),
}));
vi.mock("../../modules/sandboxes/components/agent-config-sections.js", () => ({
  AgentDescriptionSection: () => createElement("p", null, "GENERAL-BODY"),
  AgentModelSettingsSection: () => null,
}));
vi.mock("../../modules/sandboxes/components/agent-usage-actions.js", () => ({
  AgentUsageActions: () => null,
}));
vi.mock(
  "../../modules/sandboxes/components/agent-management-actions.js",
  () => ({
    AgentManagementActions: () => null,
  }),
);
vi.mock(
  "../../modules/sandboxes/components/sandbox-providers-section.js",
  () => ({
    SandboxProvidersSection: () => createElement("p", null, "PROVIDERS-BODY"),
  }),
);

const { AgentConfiguration } =
  await import("../../modules/sandboxes/components/agent-configuration.js");
const { TooltipProvider } = await import("../../components/ui/tooltip.js");

const agent = {
  requireConnectionAddress: true,
  id: "agent-a",
  name: "Alpha",
  disabled: false,
  env: [],
  access: { role: "owner", editors: [], permissions: ["sessions"] },
} as unknown as AgentView;

function render(section: "setup" | "providers") {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(AgentConfiguration, {
        agent,
        display: { state: "running", powerAction: "restart" } as never,
        section,
        onNavigate: () => {},
        onOpenSession: () => {},
        oauthReturnView: "/sandboxes/agent-a/connections",
      }),
    ),
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc;
}

describe("the settings modal's layout", () => {
  // TEST_SCENARIO: the Agent's editable name and avatar head the General section, and no other section, nor the column with the list, shows them; the section's column scrolls on its own.
  it("puts the Agent's name at the top of General", () => {
    const general = render("setup");
    const identity = general.querySelector(
      '[data-testid="agent-general-identity"]',
    )!;
    expect(identity.textContent).toContain("AGENT-NAME");
    const content = general.querySelector(
      '[data-testid="configure-agent-modal-content"]',
    )!;
    expect(content.contains(identity)).toBe(true);
    expect(content.className).toContain("overflow-y-auto");
    expect(
      general.querySelector('[data-testid="configure-agent-modal-nav"]')!
        .textContent,
    ).not.toContain("AGENT-NAME");
    const providers = render("providers");
    expect(
      providers.querySelector('[data-testid="agent-general-identity"]'),
    ).toBeNull();
    expect(providers.body.textContent).toContain("PROVIDERS-BODY");
  });

  // TEST_SCENARIO: the section list is a scroller of its own that only scrolls up and down, and can shrink below its rows (min-h-0 in a flex column), so a list taller than a short window scrolls instead of clipping the last sections; its bar has a gutter and the list keeps its right padding.
  it("scrolls the section list when it is taller than its column", () => {
    const list = render("setup").querySelector(
      '[data-testid="configure-agent-modal-nav-scroll"]',
    )!;
    const classes = list.className.split(/\s+/);
    expect(classes).toContain("md:overflow-y-auto");
    expect(classes).toContain("overflow-x-hidden");
    expect(classes).toContain("min-h-0");
    expect(classes).toContain("flex-1");
    expect(classes).toContain("md:[scrollbar-gutter:stable]");
    expect(classes).toContain("md:pr-6");
    expect(classes).toContain("min-w-0");
    const column = list.parentElement!;
    expect(column.className).toMatch(/\bflex-col\b/);
    expect(column.className).toMatch(/\bmin-h-0\b/);
  });

  // TEST_SCENARIO: an Agent with a browser lists the design's Browser section after Network access; one without a browser does not.
  it("lists Browser only for an Agent that has a browser", () => {
    const titles = (doc: Document) =>
      [...doc.querySelectorAll('[data-testid="section-nav-item"]')].map(
        (r) => r.querySelector("span span")?.textContent,
      );
    const withBrowser = titles(render("setup"));
    expect(withBrowser).toContain("Browser");
    expect(withBrowser.indexOf("Browser")).toBe(
      withBrowser.indexOf("Network access") + 1,
    );
    (agent as { requireConnectionAddress: boolean }).requireConnectionAddress =
      false;
    expect(titles(render("setup"))).not.toContain("Browser");
    (agent as { requireConnectionAddress: boolean }).requireConnectionAddress =
      true;
  });

  // TEST_SCENARIO: the open section's column keeps its own side padding and a stable gutter, so its bar sits at the modal's edge, never on a card, and appearing never shifts the layout.
  it("keeps the content clear of its scrollbar", () => {
    const content = render("setup").querySelector(
      '[data-testid="configure-agent-modal-content"]',
    )!;
    expect(content.className).toContain("[scrollbar-gutter:stable]");
    expect(content.className).toMatch(/\bpx-5\b/);
    expect(content.className).toMatch(/\bmd:px-8\b/);
  });

  // TEST_SCENARIO: each section is the design's two lines on every row, its title and its summary under it, and never wider than the list; the open row is where the keyboard starts.
  it("draws every section as title and summary", () => {
    const doc = render("providers");
    const rows = [...doc.querySelectorAll('[data-testid="section-nav-item"]')];
    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      expect(row.className).toMatch(/\bmin-w-0\b/);
      expect(row.querySelectorAll(":scope > span").length).toBe(2);
    }
    const open = rows.find((r) => r.getAttribute("aria-current") === "page")!;
    expect(open.textContent).toContain("Providers");
    expect(open.hasAttribute("data-dialog-noautofocus")).toBe(false);
    for (const row of rows.filter((r) => r !== open))
      expect(row.hasAttribute("data-dialog-noautofocus")).toBe(true);
  });
});
