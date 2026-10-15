// TEST_OVERVIEW: the browser panel's tab bar shows the agent's browser's tabs as the runtime reports them; a select or close shows at once, the way the runtime will apply it, so the active tab, the address and the title never lag the click.
import type { BrowserSnapshot } from "agent-runtime-api";
import { describe, expect, test } from "vitest";

import {
  closeTabLocally,
  selectTabLocally,
  showsTabBar,
  tabLabel,
} from "../../modules/browser/lib/tabs.js";

const tab = (id: string, url = `http://${id}/`, title = id.toUpperCase()) => ({
  id,
  url,
  title,
  loading: false,
});

const snapshot = (activeTab: string, ids: string[]): BrowserSnapshot => ({
  state: "ready",
  message: null,
  page: {
    url: `http://${activeTab}/`,
    title: activeTab.toUpperCase(),
    loading: false,
    canGoBack: true,
    canGoForward: false,
  },
  tabs: ids.map((id) => tab(id)),
  activeTab,
});

// TEST_SCENARIO: as in Safari, a browser with one tab shows no tab bar; the bar shows once there are two tabs, typically one the agent opened, and hides again when one is left.
test("shows the tab bar from two tabs on", () => {
  expect(showsTabBar(undefined)).toBe(false);
  expect(showsTabBar([])).toBe(false);
  expect(showsTabBar([tab("a")])).toBe(false);
  expect(showsTabBar([tab("a"), tab("b")])).toBe(true);
});

describe("tabLabel", () => {
  // TEST_SCENARIO: a tab is named by its page's title; a blank tab, whose title is its address, reads as a new tab, and a page without a title shows its address.
  test("names a tab by its title, else as new or by its address", () => {
    expect(tabLabel(tab("a"))).toBe("A");
    expect(tabLabel(tab("b", "about:blank", "about:blank"))).toBe("New tab");
    expect(tabLabel(tab("c", "chrome://newtab/", ""))).toBe("New tab");
    expect(tabLabel(tab("d", "http://d/x", ""))).toBe("http://d/x");
  });
});

describe("selectTabLocally", () => {
  // TEST_SCENARIO: selecting a tab moves the active mark and shows its address, title and loading at once; its history is not known until the runtime reports it, so Back and Forward wait rather than act on the old tab's history.
  test("shows the selected tab's page at once", () => {
    const next = selectTabLocally(snapshot("a", ["a", "b"]), "b");
    expect(next.activeTab).toBe("b");
    expect(next.page).toEqual({
      url: "http://b/",
      title: "B",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    });
  });

  // TEST_SCENARIO: a tab that is no longer in the list, or the one already active, changes nothing.
  test("ignores an unknown or already active tab", () => {
    const before = snapshot("a", ["a", "b"]);
    expect(selectTabLocally(before, "gone")).toBe(before);
    expect(selectTabLocally(before, "a")).toBe(before);
  });
});

describe("closeTabLocally", () => {
  // TEST_SCENARIO: closing the active tab selects the tab after it, else the one before — the runtime's own choice — and closing another tab leaves the active one.
  test("selects a predictable tab after closing the active one", () => {
    expect(closeTabLocally(snapshot("b", ["a", "b", "c"]), "b").activeTab).toBe(
      "c",
    );
    expect(closeTabLocally(snapshot("c", ["a", "b", "c"]), "c").activeTab).toBe(
      "b",
    );
    const other = closeTabLocally(snapshot("a", ["a", "b"]), "b");
    expect(other.activeTab).toBe("a");
    expect(other.tabs?.map((t) => t.id)).toEqual(["a"]);
  });

  // TEST_SCENARIO: closing the last tab leaves it shown until the runtime reports the blank tab that replaces it, so the bar is never empty.
  test("keeps the last tab until the runtime replaces it", () => {
    const before = snapshot("a", ["a"]);
    expect(closeTabLocally(before, "a")).toBe(before);
  });
});
