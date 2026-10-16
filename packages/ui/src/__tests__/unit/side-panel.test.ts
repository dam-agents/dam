import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";

import { createBrowserSlice } from "../../modules/browser/store.js";
import { createChangesSlice } from "../../modules/changes/store.js";
import { createFilesSlice } from "../../modules/files/store.js";
import {
  type DockedItems,
  dockedItemTab,
  hiddenSidePanelTabs,
  maximizableView,
  selectSidePanelTab,
  shownSidePanelWidth,
  sidePanelMinWidth,
  visibleSidePanelTab,
} from "../../modules/sessions/lib/side-panel.js";
import { createSidePanelSlice } from "../../modules/sessions/store/side-panel.js";
import type { PlatformStore } from "../../store.js";

/**
 * TEST_OVERVIEW: Every page has one side panel on the right, switched by an
 * icon bar. An Agent's chat offers Artifacts, Files, Changes, Browser and
 * Processes; every page, the chat included, offers Get started and Approvals.
 * A list tab shows its list, or the docked item it opened (a file, an
 * artifact, a process output). The Changes and Browser tabs show their docked
 * panel and nothing else. Clicking the active icon collapses the panel. A
 * conversation opens with the panel collapsed.
 */

const NOTHING_DOCKED: DockedItems = {
  file: false,
  artifact: false,
  processOutput: false,
  changes: false,
  browser: false,
  delegation: false,
};

const ALL_AVAILABLE = hiddenSidePanelTabs({
  agent: true,
  canOpenBrowser: true,
  processesEnabled: true,
  gettingStarted: true,
});

function panelStore() {
  return createStore<PlatformStore>()(
    (...a) =>
      ({
        ...createFilesSlice(...a),
        ...createBrowserSlice(...a),
        ...createChangesSlice(...a),
        ...createSidePanelSlice(...a),
      }) as PlatformStore,
  );
}

describe("which tab the side panel shows", () => {
  it("TEST_SCENARIO: a docked file belongs to the Files tab, so another tab hides it without closing it", () => {
    const docked = { ...NOTHING_DOCKED, file: true };
    expect(dockedItemTab(docked)).toBe("files");
    expect(visibleSidePanelTab("artifacts", docked, ALL_AVAILABLE)).toBe(
      "artifacts",
    );
  });

  it("TEST_SCENARIO: the Changes and Browser tabs have no list, so with nothing docked there the panel is collapsed", () => {
    expect(visibleSidePanelTab("changes", NOTHING_DOCKED, ALL_AVAILABLE)).toBe(
      null,
    );
    expect(visibleSidePanelTab("browser", NOTHING_DOCKED, ALL_AVAILABLE)).toBe(
      null,
    );
  });

  it("TEST_SCENARIO: an agent without a browser display, or with processes off, never shows those tabs", () => {
    const docked = { ...NOTHING_DOCKED, browser: true };
    const unavailable = hiddenSidePanelTabs({
      agent: true,
      canOpenBrowser: false,
      processesEnabled: false,
      gettingStarted: true,
    });
    expect(visibleSidePanelTab("browser", docked, unavailable)).toBe(null);
    expect(visibleSidePanelTab("processes", docked, unavailable)).toBe(null);
  });
});

describe("the panels outside an Agent's chat", () => {
  it("TEST_SCENARIO: a page that is not an Agent's chat offers only Get started and Approvals, so an Agent's tab left open there shows nothing", () => {
    const hidden = hiddenSidePanelTabs({
      agent: false,
      canOpenBrowser: true,
      processesEnabled: true,
      gettingStarted: true,
    });
    expect(visibleSidePanelTab("artifacts", NOTHING_DOCKED, hidden)).toBe(null);
    expect(visibleSidePanelTab("approvals", NOTHING_DOCKED, hidden)).toBe(
      "approvals",
    );
    expect(visibleSidePanelTab("getting-started", NOTHING_DOCKED, hidden)).toBe(
      "getting-started",
    );
  });

  it("TEST_SCENARIO: a dismissed or finished checklist hides Get started, so its panel closes", () => {
    const hidden = hiddenSidePanelTabs({
      agent: true,
      canOpenBrowser: true,
      processesEnabled: true,
      gettingStarted: false,
    });
    expect(visibleSidePanelTab("getting-started", NOTHING_DOCKED, hidden)).toBe(
      null,
    );
    expect(hidden.has("approvals")).toBe(false);
  });
});

describe("clicking an icon in the bar", () => {
  it("TEST_SCENARIO: the active icon collapses the panel", () => {
    expect(selectSidePanelTab("files", "files", NOTHING_DOCKED)).toEqual({
      kind: "collapse",
    });
  });

  it("TEST_SCENARIO: Changes and Browser open their panel when it is not docked yet, and only switch to it when it is", () => {
    expect(selectSidePanelTab("changes", "files", NOTHING_DOCKED)).toEqual({
      kind: "open-changes",
    });
    expect(selectSidePanelTab("browser", null, NOTHING_DOCKED)).toEqual({
      kind: "open-browser",
    });
    expect(
      selectSidePanelTab("browser", "files", {
        ...NOTHING_DOCKED,
        browser: true,
      }),
    ).toEqual({ kind: "show", tab: "browser" });
  });
});

describe("opening a docked item", () => {
  it("TEST_SCENARIO: a file, the browser or the changes opened from anywhere switch the panel to their own tab", () => {
    const store = panelStore();
    store.getState().setSidePanelTab(null);

    store.getState().setOpenFilePath("/home/agent/a.md");
    expect(store.getState().sidePanelTab).toBe("files");

    store.getState().setOpenBrowser("agent-a");
    expect(store.getState().sidePanelTab).toBe("browser");

    store.getState().setOpenChanges("agent-a");
    expect(store.getState().sidePanelTab).toBe("changes");
  });
});

describe("the panel on load", () => {
  it("TEST_SCENARIO: a conversation opens with the side panel closed and nothing maximized", () => {
    const state = panelStore().getState();
    expect(state.sidePanelTab).toBe(null);
    expect(state.sidePanelMaximized).toBe(null);
  });
});

describe("a maximized panel", () => {
  it("TEST_SCENARIO: collapsing the panel brings the chat back, so the next view opens docked rather than maximized", () => {
    const store = panelStore();
    store.getState().setOpenBrowser("agent-1");
    store.getState().setSidePanelMaximized("browser");
    store.getState().setSidePanelTab(null);
    expect(store.getState().sidePanelMaximized).toBe(null);
  });

  it("TEST_SCENARIO: closing the browser ends its maximized state", () => {
    const store = panelStore();
    store.getState().setOpenBrowser("agent-1");
    store.getState().setSidePanelMaximized("browser");
    store.getState().setOpenBrowser(null);
    expect(store.getState().sidePanelMaximized).toBe(null);
  });
});

describe("the panel width", () => {
  it("TEST_SCENARIO: a view with a higher minimum, such as the browser, shows wider than the saved width without changing it", () => {
    const min = sidePanelMinWidth("browser");
    expect(min).toBeGreaterThan(sidePanelMinWidth("files"));
    expect(shownSidePanelWidth(300, min, 900)).toBe(min);
    expect(shownSidePanelWidth(300, sidePanelMinWidth("files"), 900)).toBe(300);
  });

  it("TEST_SCENARIO: the panel never takes more than the room the chat leaves, unless the view needs it", () => {
    expect(shownSidePanelWidth(800, 280, 500)).toBe(500);
    expect(shownSidePanelWidth(800, 480, 400)).toBe(480);
  });
});

describe("the maximizable views", () => {
  it("TEST_SCENARIO: only the browser and an open file maximize, and each file is its own view", () => {
    expect(maximizableView("browser", true, null)).toBe("browser");
    expect(maximizableView("files", true, "/a.md")).toBe("file:/a.md");
    expect(maximizableView("files", false, "/a.md")).toBe(null);
    expect(maximizableView("artifacts", true, null)).toBe(null);
  });
});
