// @vitest-environment happy-dom
// TEST_OVERVIEW: on a busy machine the agent's browser can take a long time to start. The browser panel shows that it is starting, and once it has shown that for 20 seconds it says the machine is busy and offers to restart the browser, so the user is never left with only a spinner.
import type { BrowserSnapshot } from "agent-runtime-api";
import { act, createElement, Fragment, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DockedBrowserPanel } from "../../modules/browser/components/docked-browser-panel.js";

const state = vi.hoisted(() => ({
  browser: { state: "starting", message: null, page: null } as BrowserSnapshot,
  restartBrowser: vi.fn(),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({
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

vi.mock("../../modules/sessions/components/side-panel-close-button.js", () => ({
  SidePanelCloseButton: () => null,
}));

vi.mock("../../modules/browser/hooks/use-browser-control.js", () => ({
  useBrowserControl: () => ({
    connection: "live",
    connects: 1,
    browser: state.browser,
    page: {
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
    tabs: undefined,
    activeTab: null,
    error: null,
    navigate: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    selectTab: vi.fn(),
    closeTab: vi.fn(),
    newTab: vi.fn(),
    clearData: vi.fn(),
    restartBrowser: state.restartBrowser,
    reconnect: vi.fn(),
  }),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  state.browser = { state: "starting", message: null, page: null };
  state.restartBrowser.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const render = () =>
  act(() =>
    root.render(
      createElement(DockedBrowserPanel, { agentId: "agent", agentName: "Ada" }),
    ),
  );

const restartButton = () =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Restart browser",
  );

describe("a slow browser start", () => {
  // TEST_SCENARIO: the panel shows "Starting the agent's browser…" alone at first; after 20 seconds of it, it says the machine is busy and shows a Restart browser button, and pressing it restarts the agent's browser.
  test("offers a restart after 20 seconds of starting", () => {
    render();
    expect(container.textContent).toContain("Starting the agent's browser…");
    expect(restartButton()).toBeUndefined();

    act(() => vi.advanceTimersByTime(19_000));
    expect(restartButton()).toBeUndefined();

    act(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toContain("machine is busy");
    act(() => restartButton()!.click());
    expect(state.restartBrowser).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: a restart pressed while the browser is still starting leaves it starting, so the panel hides the busy notice at once and counts another 20 seconds before it shows it again.
  test("hides the busy notice after a restart and counts again", () => {
    render();
    act(() => vi.advanceTimersByTime(20_000));
    act(() => restartButton()!.click());
    expect(state.restartBrowser).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("machine is busy");
    expect(restartButton()).toBeUndefined();

    act(() => vi.advanceTimersByTime(19_000));
    expect(restartButton()).toBeUndefined();
    act(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toContain("machine is busy");
  });

  // TEST_SCENARIO: a browser that comes up in time never shows the busy notice; and once the browser starts again, its 20 seconds count from then.
  test("counts the 20 seconds from each start", () => {
    render();
    act(() => vi.advanceTimersByTime(15_000));
    state.browser = { state: "ready", message: null, page: null };
    render();
    expect(container.textContent).not.toContain("machine is busy");

    state.browser = { state: "starting", message: null, page: null };
    render();
    act(() => vi.advanceTimersByTime(15_000));
    expect(restartButton()).toBeUndefined();
    act(() => vi.advanceTimersByTime(5_000));
    expect(restartButton()).toBeDefined();
  });
});
