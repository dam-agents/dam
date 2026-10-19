import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const ORIGIN = "http://ui";
  interface Entry {
    key: string;
    url: string;
    state: unknown;
  }
  const location = {
    href: `${ORIGIN}/`,
    pathname: "/",
    search: "",
    hash: "",
    origin: ORIGIN,
  };
  let entries: Entry[] = [];
  let index = 0;
  let nextKey = 0;
  const windowListeners = new Map<string, () => void>();
  const navListeners: ((e: { from: { index: number } }) => void)[] = [];
  const entryAt = (i: number) => ({
    key: entries[i]!.key,
    url: entries[i]!.url,
    index: i,
  });
  const show = () => {
    const url = new URL(entries[index]!.url);
    location.href = url.href;
    location.pathname = url.pathname;
    location.search = url.search;
    location.hash = url.hash;
  };
  const changed = (from: number) => {
    for (const fn of navListeners) fn({ from: { index: from } });
  };
  const traverse = (to: number) => {
    if (to < 0 || to >= entries.length) return;
    const from = index;
    index = to;
    show();
    setTimeout(() => {
      changed(from);
      windowListeners.get("popstate")?.();
    });
  };
  const history = {
    get state() {
      return entries[index]!.state;
    },
    pushState: vi.fn((state: unknown, _title: string, url?: string) => {
      const from = index;
      entries.splice(index + 1);
      entries.push({
        key: `k${String(nextKey++)}`,
        url: new URL(url ?? entries[index]!.url, ORIGIN).href,
        state,
      });
      index++;
      show();
      changed(from);
    }),
    replaceState: vi.fn((state: unknown, _title: string, url?: string) => {
      const current = entries[index]!;
      entries[index] = {
        key: current.key,
        url: new URL(url ?? current.url, ORIGIN).href,
        state,
      };
      show();
      changed(index);
    }),
    back: vi.fn(() => traverse(index - 1)),
    forward: vi.fn(() => traverse(index + 1)),
  };
  const navigation = {
    get currentEntry() {
      return entryAt(index);
    },
    entries: () => entries.map((_, i) => entryAt(i)),
    addEventListener: (
      _type: string,
      fn: (e: { from: { index: number } }) => void,
    ) => navListeners.push(fn),
  };
  const reset = (path: string) => {
    entries = [
      { key: `k${String(nextKey++)}`, url: ORIGIN + path, state: null },
    ];
    index = 0;
    show();
  };
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", history);
  vi.stubGlobal("navigation", navigation);
  vi.stubGlobal("window", {
    location,
    history,
    navigation,
    addEventListener: (type: string, fn: () => void) =>
      windowListeners.set(type, fn),
    removeEventListener: () => {},
  });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { location, history, navigation, reset, index: () => index };
});

import { installBrowserHistory } from "../../modules/platform/hooks/use-browser-history.js";
import { holdBackEntry } from "../../modules/platform/lib/back-entry.js";
import { useStore } from "../../store.js";

// TEST_OVERVIEW: On a phone the side panel covers the chat like a page of its own. While it is open it holds one history entry above the chat's entry, so Back closes the panel and leaves the chat as it was. A dialog above the panel takes the Back first. A panel closed any other way gives its entry back, and other history writers (the session URL sync, in-app navigation) never leave the entry behind to eat a later Back.

const settle = () => new Promise((resolve) => setTimeout(resolve));

afterEach(() => {
  vi.restoreAllMocks();
});

function openChat() {
  env.reset("/chat/a1");
  const uninstall = installBrowserHistory();
  useStore.setState({ pendingResumeSessionId: null });
  const resetChatContext = vi.spyOn(useStore.getState(), "resetChatContext");
  return { uninstall, resetChatContext };
}

const closes = () => vi.fn(() => true);

describe("a view holding a Back entry", () => {
  // TEST_SCENARIO: the phone's Back gesture with the full-screen panel open closes the panel and keeps the chat: the route is not applied again, so the chat is not reset.
  it("closes the view on Back without applying the route", async () => {
    const { uninstall, resetChatContext } = openChat();
    const onBack = closes();
    holdBackEntry(onBack);

    env.history.back();
    await settle();

    expect(onBack).toHaveBeenCalledOnce();
    expect(resetChatContext).not.toHaveBeenCalled();
    expect(env.index()).toBe(0);
    expect(env.location.pathname).toBe("/chat/a1");
    uninstall();
  });

  // TEST_SCENARIO: the panel closed with its own arrow or Escape pops its entry, and that pop is not taken as a route change, so the chat is not reset and the next Back leaves the chat.
  it("gives its entry back when the view closes another way", async () => {
    const { uninstall, resetChatContext } = openChat();
    const onBack = closes();
    const release = holdBackEntry(onBack);
    expect(env.index()).toBe(1);

    release();
    await settle();
    await settle();

    expect(env.index()).toBe(0);
    expect(onBack).not.toHaveBeenCalled();
    expect(resetChatContext).not.toHaveBeenCalled();
    uninstall();
  });

  // TEST_SCENARIO: React's development mode unmounts and mounts an effect again in one tick. The view keeps one entry, and Back still closes it.
  it("keeps one entry across a release and a hold in the same tick", async () => {
    const { uninstall } = openChat();
    const onBack = closes();
    holdBackEntry(closes())();
    holdBackEntry(onBack);
    await settle();

    expect(env.index()).toBe(1);
    env.history.back();
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
    uninstall();
  });

  // TEST_SCENARIO: a dialog opened over the panel, such as the starter kit browser from Get started, takes the Back first. The panel stays open and keeps its entry, so the Back after the dialog closes closes the panel.
  it("keeps the view and its entry when the view refuses the Back", async () => {
    const { uninstall, resetChatContext } = openChat();
    let dialogOpen = true;
    const onBack = vi.fn(() => !dialogOpen);
    holdBackEntry(onBack);

    env.history.back();
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
    expect(env.index()).toBe(1);

    dialogOpen = false;
    env.history.back();
    await settle();
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(env.index()).toBe(0);
    expect(resetChatContext).not.toHaveBeenCalled();
    uninstall();
  });

  // TEST_SCENARIO: the session URL sync replaces the held entry's URL and state while the panel is open, as when a session starts. The entry is still the panel's: closing the panel either way pops it without resetting the chat, and the chat keeps the session URL.
  it("follows its entry through a replace by the session URL sync", async () => {
    for (const close of ["back", "arrow"] as const) {
      const { uninstall, resetChatContext } = openChat();
      const release = holdBackEntry(closes());
      env.history.replaceState(null, "", "/chat/a1/s1");

      if (close === "back") env.history.back();
      else release();
      await settle();
      await settle();

      expect(env.index()).toBe(0);
      expect(env.location.pathname).toBe("/chat/a1/s1");
      expect(resetChatContext).not.toHaveBeenCalled();
      uninstall();
      vi.restoreAllMocks();
    }
  });

  // TEST_SCENARIO: in-app navigation pushes another chat over the held entry, and the panel closes with it. Back from that chat returns to the first chat in one step, applying its route once, instead of stopping on the left entry and reloading the chat again.
  it("skips its left entry after in-app navigation pushed above it", async () => {
    const { uninstall, resetChatContext } = openChat();
    const release = holdBackEntry(closes());
    env.history.pushState(null, "", "/chat/a2");
    useStore.setState({ selectedAgent: "a2" });
    release();
    await settle();

    env.history.back();
    await settle();
    await settle();

    expect(env.index()).toBe(0);
    expect(useStore.getState().selectedAgent).toBe("a1");
    expect(resetChatContext).toHaveBeenCalledOnce();
    uninstall();
  });

  // TEST_SCENARIO: a browser without the Navigation API holds nothing, so Back behaves as before this change.
  it("holds nothing without the Navigation API", () => {
    env.reset("/chat/a1");
    env.history.pushState.mockClear();
    vi.stubGlobal("navigation", undefined);
    try {
      holdBackEntry(closes())();
      expect(env.history.pushState).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("navigation", env.navigation);
    }
  });
});
