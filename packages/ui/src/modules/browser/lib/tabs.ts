import type { BrowserSnapshot, TabState } from "agent-runtime-api";

const BLANK_URLS = new Set(["", "about:blank", "chrome://newtab/"]);

export const READABLE_TAB_WIDTH = 176;
export const SHRUNK_TAB_WIDTH = 64;
export const TAB_GAP = 4;

export function tabWidths(
  barWidth: number,
  count: number,
  activeIndex: number,
): number[] {
  const room = barWidth - TAB_GAP * (count - 1);
  const even = Math.max(Math.floor(room / count), 0);
  const all = (width: number) => Array.from({ length: count }, () => width);
  if (even >= READABLE_TAB_WIDTH || count === 1) return all(even);
  if (activeIndex < 0 || activeIndex >= count)
    return all(Math.max(even, SHRUNK_TAB_WIDTH));
  const active = Math.min(READABLE_TAB_WIDTH, room);
  const inactive = Math.max(
    SHRUNK_TAB_WIDTH,
    Math.floor((room - active) / (count - 1)),
  );
  return all(inactive).map((w, i) => (i === activeIndex ? active : w));
}

export function showsTabBar(tabs: TabState[] | undefined): tabs is TabState[] {
  return (tabs?.length ?? 0) > 1;
}

export function tabLabel(tab: TabState): string {
  if (tab.title && tab.title !== tab.url && tab.title !== "about:blank")
    return tab.title;
  return BLANK_URLS.has(tab.url) ? "New tab" : tab.url;
}

export function selectTabLocally(
  snapshot: BrowserSnapshot,
  id: string,
): BrowserSnapshot {
  const tab = snapshot.tabs?.find((t) => t.id === id);
  if (!tab || snapshot.activeTab === id) return snapshot;
  return {
    ...snapshot,
    activeTab: id,
    page: {
      url: tab.url,
      title: tab.title,
      loading: tab.loading,
      canGoBack: false,
      canGoForward: false,
    },
  };
}

export function closeTabLocally(
  snapshot: BrowserSnapshot,
  id: string,
): BrowserSnapshot {
  const tabs = snapshot.tabs;
  const at = tabs?.findIndex((t) => t.id === id) ?? -1;
  if (!tabs || at === -1 || tabs.length === 1) return snapshot;
  const rest = tabs.filter((t) => t.id !== id);
  const closed = { ...snapshot, tabs: rest };
  if (snapshot.activeTab !== id) return closed;
  const next = tabs[at + 1] ?? tabs[at - 1];
  return next ? selectTabLocally(closed, next.id) : closed;
}
