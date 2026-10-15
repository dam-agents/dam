import type { BrowserSnapshot, TabState } from "agent-runtime-api";

const BLANK_URLS = new Set(["", "about:blank", "chrome://newtab/"]);

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
