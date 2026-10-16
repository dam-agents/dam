import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";

import type { KeyValueStore } from "../../lib/safe-storage.js";
import { createBrowserSlice } from "../../modules/browser/store.js";
import { createChangesSlice } from "../../modules/changes/store.js";
import { createFilesSlice } from "../../modules/files/store.js";
import {
  DEFAULT_SIDE_PANEL_TAB,
  type DockedItems,
  dockedItemTab,
  readSidePanelTab,
  selectSidePanelTab,
  visibleSidePanelTab,
  writeSidePanelTab,
} from "../../modules/sessions/lib/side-panel.js";
import { createSidePanelSlice } from "../../modules/sessions/store/side-panel.js";
import type { PlatformStore } from "../../store.js";

/**
 * TEST_OVERVIEW: The chat view has one side panel on the right, switched by an
 * icon bar: Files, Changes, Artifacts, Browser and Processes. A list tab shows
 * its list, or the docked item it opened (a file, an artifact, a process
 * output). The Changes and Browser tabs show their docked panel and nothing
 * else. Clicking the active icon collapses the panel. The list tab the user
 * chose last, or the collapsed state, persists in browser storage.
 */

const NOTHING_DOCKED: DockedItems = {
  file: false,
  artifact: false,
  processOutput: false,
  changes: false,
  browser: false,
  delegation: false,
};

const ALL_AVAILABLE = { canOpenBrowser: true, processesEnabled: true };

function mapStore(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(seed));
  return {
    keys: () => [...map.keys()],
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

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
    const unavailable = { canOpenBrowser: false, processesEnabled: false };
    expect(visibleSidePanelTab("browser", docked, unavailable)).toBe(null);
    expect(visibleSidePanelTab("processes", docked, unavailable)).toBe(null);
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

describe("the persisted tab", () => {
  it("TEST_SCENARIO: a list tab and the collapsed state survive a reload", () => {
    const store = mapStore();
    writeSidePanelTab("artifacts", store);
    expect(readSidePanelTab(store)).toBe("artifacts");
    writeSidePanelTab(null, store);
    expect(readSidePanelTab(store)).toBe(null);
  });

  it("TEST_SCENARIO: a tab that only shows a docked item is not kept, since that item is gone after a reload", () => {
    const store = mapStore();
    writeSidePanelTab("processes", store);
    writeSidePanelTab("browser", store);
    expect(readSidePanelTab(store)).toBe("processes");
  });

  it("TEST_SCENARIO: nothing stored, or a value this version does not know, opens the default tab", () => {
    expect(readSidePanelTab(mapStore())).toBe(DEFAULT_SIDE_PANEL_TAB);
    expect(
      readSidePanelTab(mapStore({ "platform-side-panel-tab": "diff" })),
    ).toBe(DEFAULT_SIDE_PANEL_TAB);
  });
});
