// @vitest-environment happy-dom
// TEST_OVERVIEW: With the Unified right toolbar on, every knob of an Agent's configuration page moves into a side panel: each section the page holds maps to the panel that carries it, and every link and deep link to the page opens that panel in the chat instead. With the experiment off, the links go to the page as before and the panels do not exist.
import { beforeEach, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { environmentsPanelShown } from "../../modules/environments/lib/environments-tab.js";
import { createFeaturesSlice } from "../../modules/features/store.js";
import type { SandboxSection } from "../../modules/platform/lib/routes.js";
import { createNavigationSlice } from "../../modules/platform/store/navigation.js";
import { channelsPanelShown } from "../../modules/sandboxes/lib/channels-surface.js";
import { SIDE_PANEL_TABS } from "../../modules/sessions/components/side-panel-bar.js";
import {
  configRedirectTab,
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
  // UNIT_BOUNDARY_DESCRIPTION: eleven sections share six panels: Providers, Connections, Environment vars and Network access are the Services panel, General and Usage the Spending one, and Chat forms has none.
  expect(new Set(panels).size).toBe(6);
  expect(panels).toEqual([
    "agent",
    "services",
    "services",
    "services",
    "services",
    "channels",
    "agent",
    "skills",
    "schedules",
    "environments",
    "agent",
  ]);
  expect([...CONFIGURATION_TABS].sort()).toEqual(
    [
      "agent",
      "channels",
      "environments",
      "schedules",
      "services",
      "skills",
    ].sort(),
  );
});

// TEST_SCENARIO: every configuration tab has a rail tile and a panel, so a tile never opens an empty panel.
it("has a rail entry for every configuration panel", () => {
  const railTabs = SIDE_PANEL_TABS.map((entry) => entry.tab);
  for (const tab of CONFIGURATION_TABS) expect(railTabs).toContain(tab);
});

// TEST_SCENARIO: with the experiment on, a link or a bookmark for the configuration page opens the chat on the panel that holds that section — Providers and Environment vars among them open Services; with it off, the page opens as it always has.
it("opens the panel instead of the page, and the page when the experiment is off", () => {
  const on = navigationStore(true);
  on.getState().navigateToSandboxHome("agent-1", "network");
  expect(on.getState().view).toBe("chat");
  expect(on.getState().sidePanelTab).toBe("services");
  expect(location.pathname).toBe("/chat/agent-1");

  // UNIT_BOUNDARY_DESCRIPTION: a link inside the same conversation opens the panel and goes nowhere, so the reader keeps the place in the chat.
  on.setState({ view: "chat", selectedAgent: "agent-1", sidePanelTab: null });
  const before = history.length;
  on.getState().navigateToSandboxHome("agent-1", "providers");
  expect(on.getState().sidePanelTab).toBe("services");
  expect(history.length).toBe(before);

  const off = navigationStore(false);
  off.getState().navigateToSandboxHome("agent-1", "network");
  expect(off.getState().view).toBe("sandbox-home");
  expect(off.getState().sidePanelTab).toBe(null);
});

// TEST_SCENARIO: a configuration address becomes a panel only when the install's flag says so; a browser that stored the experiment on last does not redirect a page the install turned off.
it("redirects a configuration address only with the install's flag", () => {
  expect(configRedirectTab(true, "network")).toBe("services");
  expect(configRedirectTab(true, "usage")).toBe("agent");
  expect(configRedirectTab(false, "network")).toBe(null);
});

// TEST_SCENARIO: the Channels panel is offered only where the install offers a messenger to bind, since that panel is the only place to bind one under the experiment.
it("offers the Channels panel only when a messenger exists", () => {
  expect(channelsPanelShown({ slack: true })).toBe(true);
  expect(channelsPanelShown({ telegram: true })).toBe(true);
  expect(channelsPanelShown({})).toBe(false);
  expect(channelsPanelShown({ slack: false, telegram: false })).toBe(false);
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
    channels: true,
    gettingStarted: true,
  };
  const on = hiddenSidePanelTabs({ ...available, configuration: true });
  const off = hiddenSidePanelTabs({ ...available, configuration: false });
  const gated = CONFIGURATION_TABS.filter((tab) => tab !== "environments");
  for (const tab of gated) {
    expect(on.has(tab)).toBe(false);
    expect(off.has(tab)).toBe(true);
  }
  // UNIT_BOUNDARY_DESCRIPTION: Environments was a panel of its own before this experiment, so the environments feature, not the toolbar, decides whether it exists.
  expect(off.has("environments")).toBe(false);
});

// TEST_SCENARIO: the Environments panel is offered once the agent owns one, and the Manage row's access-list link opens it before that; with the feature off it never appears, open or not.
it("offers the Environments panel only once the agent owns one, or when its access list is opened", () => {
  const shown = (count: number | undefined, open = false) =>
    environmentsPanelShown({ enabled: true, count, open });
  expect(shown(1)).toBe(true);
  expect(shown(0)).toBe(false);
  expect(shown(0, true)).toBe(true);
  expect(shown(undefined, true)).toBe(true);
  expect(environmentsPanelShown({ enabled: false, count: 1, open: true })).toBe(
    false,
  );
});
