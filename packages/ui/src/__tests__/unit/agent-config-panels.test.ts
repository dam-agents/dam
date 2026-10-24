// @vitest-environment happy-dom
// TEST_OVERVIEW: With the Unified right toolbar on, every knob of an Agent's configuration page moves into a side panel: each section the page holds maps to the panel that carries it, every link and deep link to the page opens that panel in the chat instead, and the Docs tile opens the published documentation in a panel with a way out to a new tab. With the experiment off, the links go to the page as before and the panels do not exist.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { DOCS_URL } from "../../constants.js";
import { createFeaturesSlice } from "../../modules/features/store.js";
import type { SandboxSection } from "../../modules/platform/lib/routes.js";
import { createNavigationSlice } from "../../modules/platform/store/navigation.js";
import { DocumentationPanel } from "../../modules/sessions/components/documentation-panel.js";
import { SIDE_PANEL_TABS } from "../../modules/sessions/components/side-panel-bar.js";
import {
  configTabForSection,
  CONFIGURATION_TABS,
  hiddenSidePanelTabs,
} from "../../modules/sessions/lib/side-panel.js";
import { createSidePanelSlice } from "../../modules/sessions/store/side-panel.js";
import type { PlatformStore } from "../../store.js";

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ setSidePanelTab: vi.fn(), showConfirm: vi.fn() }),
}));

const SECTIONS: readonly SandboxSection[] = [
  "setup",
  "providers",
  "connections",
  "network",
  "environment",
  "channels",
  "chat-forms",
  "skills",
  "schedules",
  "environments",
  "usage",
];

function navigationStore(unifiedToolbar: boolean) {
  const selected: string[] = [];
  return createStore<PlatformStore>()(
    (...a) =>
      ({
        ...createNavigationSlice(...a),
        ...createSidePanelSlice(...a),
        ...createFeaturesSlice(...a),
        unifiedToolbar,
        selectAgent: (id: string) => {
          selected.push(id);
          a[0]({ view: "chat", selectedAgent: id } as Partial<PlatformStore>);
        },
        leaveChatContext: (navigate: () => void) => navigate(),
        selected,
      }) as unknown as PlatformStore,
  );
}

beforeEach(() => {
  history.replaceState(null, "", "/");
});

// TEST_SCENARIO: every section of the configuration page has a panel that carries its knobs, so no setting is left without a home once the page is gone. The Environments panel keeps its own renderer, and Documentation is no section of the page.
it("maps every configuration section to a panel", () => {
  const panels = SECTIONS.map(configTabForSection);
  expect(new Set(panels).size).toBe(panels.length - 1);
  expect(panels).toEqual([
    "agent",
    "providers",
    "connections",
    "network",
    "environment",
    "channels",
    "chat-forms",
    "skills",
    "schedules",
    "environments",
    "agent",
  ]);
  expect([...CONFIGURATION_TABS].sort()).toEqual(
    [
      "agent",
      "channels",
      "chat-forms",
      "connections",
      "environment",
      "environments",
      "network",
      "providers",
      "schedules",
      "skills",
    ].sort(),
  );
});

// TEST_SCENARIO: the rail names every panel the configuration holds, so the Configure menu and the panels agree on one list.
it("has a rail entry for every configuration panel", () => {
  const railTabs = SIDE_PANEL_TABS.map((entry) => entry.tab);
  for (const tab of CONFIGURATION_TABS) expect(railTabs).toContain(tab);
});

// TEST_SCENARIO: with the experiment on, a link or a bookmark for the configuration page opens the chat on the panel that holds that section; with it off, the page opens as it always has.
it("opens the panel instead of the page, and the page when the experiment is off", () => {
  const on = navigationStore(true);
  on.getState().navigateToSandboxHome("agent-1", "network");
  expect(on.getState().view).toBe("chat");
  expect(on.getState().sidePanelTab).toBe("network");
  expect(location.pathname).toBe("/chat/agent-1");

  // UNIT_BOUNDARY_DESCRIPTION: a link inside the same conversation opens the panel and goes nowhere, so the reader keeps the place in the chat.
  on.setState({ view: "chat", selectedAgent: "agent-1", sidePanelTab: null });
  const before = history.length;
  on.getState().navigateToSandboxHome("agent-1", "providers");
  expect(on.getState().sidePanelTab).toBe("providers");
  expect(history.length).toBe(before);

  const off = navigationStore(false);
  off.getState().navigateToSandboxHome("agent-1", "network");
  expect(off.getState().view).toBe("sandbox-home");
  expect(off.getState().sidePanelTab).toBe(null);
});

// TEST_SCENARIO: with the experiment off, none of the configuration panels exists, so one left open closes; with it on, all of them do.
it("hides every configuration panel with the experiment off", () => {
  const available = {
    agent: true,
    artifacts: true,
    canOpenBrowser: true,
    changes: true,
    processesEnabled: true,
    environments: true,
    gettingStarted: true,
  };
  const on = hiddenSidePanelTabs({ ...available, configuration: true });
  const off = hiddenSidePanelTabs({ ...available, configuration: false });
  const gated = [
    ...CONFIGURATION_TABS.filter((tab) => tab !== "environments"),
    "documentation",
  ] as const;
  for (const tab of gated) {
    expect(on.has(tab)).toBe(false);
    expect(off.has(tab)).toBe(true);
  }
  // UNIT_BOUNDARY_DESCRIPTION: Environments was a panel of its own before this experiment, so the environments feature, not the toolbar, decides whether it exists.
  expect(off.has("environments")).toBe(false);
});

// TEST_SCENARIO: the Documentation panel frames the published docs and offers the same page in a new tab from its top bar.
it("frames the docs and offers them in a new window", () => {
  const html = renderToStaticMarkup(
    createElement(TooltipProvider, null, createElement(DocumentationPanel, {})),
  );
  expect(html).toContain(`src="${DOCS_URL}"`);
  expect(html).toContain(`href="${DOCS_URL}"`);
  expect(html).toContain('data-testid="documentation-open"');
  expect(html).toContain('aria-label="Open documentation in a new window"');
});
