// TEST_OVERVIEW: the browser panel's top bar carries the button that opens a new tab, so a person reaches it whether or not the tab bar shows; the tab bar itself, shown from two tabs on, holds the tabs and their list, and no second new-tab button.
import type { TabState } from "agent-runtime-api";
import { createElement, Fragment, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DockedBrowserPanel } from "../../modules/browser/components/docked-browser-panel.js";

const state = vi.hoisted(() => ({
  tabs: [] as TabState[],
  newTab: vi.fn(),
  buttons: {} as Record<string, () => void>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    "aria-label": label,
  }: PropsWithChildren<{ onClick?: () => void; "aria-label"?: string }>) => {
    if (label && onClick) state.buttons[label] = onClick;
    return createElement("button", { "aria-label": label }, children);
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
      setOpenBrowser: vi.fn(),
      browserMaximized: false,
      setBrowserMaximized: vi.fn(),
      showConfirm: vi.fn(),
      browserOpenRequest: null,
      takeBrowserOpenRequest: () => null,
    }),
}));

vi.mock("../../lib/persisted-prefs.js", () => ({
  readPersistedFlag: () => true,
  writePersistedFlag: vi.fn(),
}));

vi.mock("../../modules/browser/components/stream-view.js", () => ({
  StreamView: () => null,
}));

vi.mock("../../modules/browser/hooks/use-browser-control.js", () => ({
  useBrowserControl: () => ({
    connection: "live",
    connects: 0,
    browser: { state: "ready", message: null },
    testingMode: true,
    page: {
      url: "http://a/",
      title: "A",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
    tabs: state.tabs,
    activeTab: state.tabs[0]?.id ?? null,
    error: null,
    navigate: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    selectTab: vi.fn(),
    closeTab: vi.fn(),
    newTab: state.newTab,
    clearData: vi.fn(),
    restartBrowser: vi.fn(),
    setTestingMode: vi.fn(),
    reconnect: vi.fn(),
  }),
}));

const tab = (id: string): TabState => ({
  id,
  url: `http://${id}/`,
  title: id.toUpperCase(),
  loading: false,
});

const render = () =>
  renderToStaticMarkup(
    createElement(DockedBrowserPanel, { agentId: "agent", agentName: "Ada" }),
  );

const newTabButtons = (markup: string) =>
  markup.split('aria-label="New tab"').length - 1;

beforeEach(() => {
  state.buttons = {};
  state.newTab.mockClear();
});

describe("the new-tab button", () => {
  // TEST_SCENARIO: a browser with one tab shows no tab bar, yet the top bar still offers a new tab, and pressing it asks the agent's browser for one — the second tab, which then brings the bar.
  test("opens a tab from the top bar while the tab bar is hidden", () => {
    state.tabs = [tab("a")];
    const markup = render();
    expect(markup).not.toContain('data-testid="browser-tabs"');
    expect(newTabButtons(markup)).toBe(1);
    state.buttons["New tab"]!();
    expect(state.newTab).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: with the tab bar shown, the new-tab button stays in the top bar alone; the tab bar has none of its own.
  test("stays the top bar's alone when the tab bar shows", () => {
    state.tabs = [tab("a"), tab("b"), tab("c")];
    const markup = render();
    expect(markup).toContain('data-testid="browser-tabs"');
    expect(newTabButtons(markup)).toBe(1);
    const topBar = markup.slice(
      0,
      markup.indexOf('data-testid="browser-tabs"'),
    );
    expect(newTabButtons(topBar)).toBe(1);
  });
});
