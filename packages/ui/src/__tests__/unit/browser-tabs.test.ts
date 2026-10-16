// TEST_OVERVIEW: the browser panel's tab bar shows the agent's browser's tabs as the runtime reports them, sized as in Safari; a select or close shows at once, the way the runtime will apply it, so the active tab, the address and the title never lag the click.
import type { BrowserSnapshot } from "agent-runtime-api";
import { describe, expect, test } from "vitest";

import {
  closeTabLocally,
  READABLE_TAB_WIDTH,
  selectTabLocally,
  showsTabBar,
  SHRUNK_TAB_WIDTH,
  TAB_GAP,
  tabLabel,
  tabWidths,
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

describe("tabWidths", () => {
  const bar = (tabs: number, each: number) =>
    tabs * each + (tabs - 1) * TAB_GAP;

  // TEST_SCENARIO: as in Safari, tabs whose titles are readable at an even share split the bar's width evenly, whichever tab is active, and fill it.
  test("splits the bar evenly while every title is readable", () => {
    expect(tabWidths(bar(2, 300), 2, 0)).toEqual([300, 300]);
    expect(tabWidths(bar(3, 200), 3, 2)).toEqual([200, 200, 200]);
    expect(tabWidths(bar(4, READABLE_TAB_WIDTH), 4, 1)).toEqual(
      Array(4).fill(READABLE_TAB_WIDTH),
    );
  });

  // TEST_SCENARIO: with too many tabs for an even share to be readable, the active tab keeps a readable width and the inactive tabs share the rest of the bar evenly; the bar is still filled, never more.
  test("reserves a readable width for the active tab when titles do not fit", () => {
    const width = bar(6, 100);
    const widths = tabWidths(width, 6, 2);
    expect(widths[2]).toBe(READABLE_TAB_WIDTH);
    const inactive = widths.filter((_, i) => i !== 2);
    expect(new Set(inactive).size).toBe(1);
    expect(inactive[0]).toBeLessThan(100);
    const total = widths.reduce((a, b) => a + b, 0) + 5 * TAB_GAP;
    expect(total).toBeLessThanOrEqual(width);
    expect(total).toBeGreaterThan(width - 6);
  });

  // TEST_SCENARIO: selecting another tab moves the reserved width with it: the newly active tab grows and the one before shrinks, so the panel animates between the two.
  test("moves the reserved width with the selection", () => {
    const before = tabWidths(bar(6, 100), 6, 2);
    const after = tabWidths(bar(6, 100), 6, 4);
    expect(after[4]).toBe(READABLE_TAB_WIDTH);
    expect(after[2]).toBe(before[4]);
  });

  // TEST_SCENARIO: inactive tabs never shrink below a minimum; past it the tabs overflow the bar, which scrolls and offers the list of all tabs instead.
  test("keeps inactive tabs at a minimum width, then overflows", () => {
    const widths = tabWidths(400, 20, 0);
    expect(widths[0]).toBe(READABLE_TAB_WIDTH);
    expect(widths.slice(1)).toEqual(Array(19).fill(SHRUNK_TAB_WIDTH));
  });

  // TEST_SCENARIO: while the active tab is not in the list yet, no tab gets the reserved width, and the tabs share the bar evenly, down to the minimum.
  test("shares the bar evenly without an active tab", () => {
    expect(tabWidths(bar(6, 100), 6, -1)).toEqual(Array(6).fill(100));
  });
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
