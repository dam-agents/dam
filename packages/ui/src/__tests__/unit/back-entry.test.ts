import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const location = { pathname: "/", search: "", hash: "", origin: "http://ui" };
  const entries: { state: unknown; path: string }[] = [
    { state: null, path: "/" },
  ];
  let index = 0;
  const listeners = new Map<string, () => void>();
  const show = () => {
    location.pathname = entries[index]!.path;
  };
  const history = {
    get state() {
      return entries[index]!.state;
    },
    get length() {
      return entries.length;
    },
    pushState: vi.fn((state: unknown, _title: string, url?: string) => {
      entries.splice(index + 1);
      entries.push({ state, path: url ?? entries[index]!.path });
      index++;
      show();
    }),
    replaceState: vi.fn((state: unknown, _title: string, url?: string) => {
      entries[index] = { state, path: url ?? entries[index]!.path };
      show();
    }),
    back: vi.fn(() => {
      if (index === 0) return;
      index--;
      show();
      setTimeout(() => listeners.get("popstate")?.());
    }),
  };
  const reset = (path: string) => {
    entries.splice(0, entries.length, { state: null, path });
    index = 0;
    show();
  };
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", history);
  vi.stubGlobal("window", {
    location,
    history,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: () => {},
  });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { location, history, reset, index: () => index };
});

import { installBrowserHistory } from "../../modules/platform/hooks/use-browser-history.js";
import { holdBackEntry } from "../../modules/platform/lib/back-entry.js";
import { useStore } from "../../store.js";

// TEST_OVERVIEW: On a phone the side panel covers the chat like a page of its own. While it is open it holds a history entry at the chat's URL, so Back closes the panel and leaves the chat as it was; a panel closed any other way gives its entry back, so the next Back leaves the chat as before.

const settle = () => new Promise((resolve) => setTimeout(resolve));

afterEach(() => {
  vi.restoreAllMocks();
});

function openChat() {
  env.reset("/chat/a1");
  const uninstall = installBrowserHistory();
  useStore.setState({ pendingResumeSessionId: null });
  return uninstall;
}

describe("a view holding a Back entry", () => {
  // TEST_SCENARIO: the phone's Back gesture with the full-screen panel open closes the panel and keeps the chat: the route is not applied again, so the chat is not reset.
  it("closes the view on Back without applying the route", async () => {
    const uninstall = openChat();
    const resetChatContext = vi.spyOn(useStore.getState(), "resetChatContext");
    const close = vi.fn();
    holdBackEntry(close);

    env.history.back();
    await settle();

    expect(close).toHaveBeenCalledOnce();
    expect(resetChatContext).not.toHaveBeenCalled();
    expect(env.location.pathname).toBe("/chat/a1");
    uninstall();
  });

  // TEST_SCENARIO: the panel closed with its own arrow or Escape pops its entry, and that pop is not taken as a route change, so the chat is not reset and the next Back leaves the chat.
  it("gives its entry back when the view closes another way", async () => {
    const uninstall = openChat();
    const resetChatContext = vi.spyOn(useStore.getState(), "resetChatContext");
    const close = vi.fn();
    const release = holdBackEntry(close);
    expect(env.index()).toBe(1);

    release();
    await settle();
    await settle();

    expect(env.index()).toBe(0);
    expect(close).not.toHaveBeenCalled();
    expect(resetChatContext).not.toHaveBeenCalled();
    uninstall();
  });

  // TEST_SCENARIO: React's development mode unmounts and mounts an effect again in one tick. The view keeps one entry, and Back still closes it.
  it("keeps one entry across a release and a hold in the same tick", async () => {
    const uninstall = openChat();
    const close = vi.fn();
    holdBackEntry(vi.fn())();
    holdBackEntry(close);
    await settle();

    expect(env.index()).toBe(1);
    env.history.back();
    await settle();
    expect(close).toHaveBeenCalledOnce();
    uninstall();
  });

  // TEST_SCENARIO: the app moved to another URL while the view was open, and Back returns to the entry held for the view. That is a real route change, so the router applies it, and the Back after it closes the view.
  it("lets the router apply a Back that changes the URL", async () => {
    const uninstall = openChat();
    const close = vi.fn();
    holdBackEntry(close);
    env.history.pushState(null, "", "/chat/a2");
    useStore.setState({ selectedAgent: "a2" });

    env.history.back();
    await settle();
    expect(close).not.toHaveBeenCalled();
    expect(useStore.getState().selectedAgent).toBe("a1");

    env.history.back();
    await settle();
    expect(close).toHaveBeenCalledOnce();
    uninstall();
  });
});
