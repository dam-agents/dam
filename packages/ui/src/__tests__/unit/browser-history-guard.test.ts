import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const location = {
    pathname: "/chat/a1",
    search: "?q=1",
    hash: "",
    origin: "http://ui",
  };
  const listeners = new Map<string, () => void>();
  const history = {
    state: "in-app" as unknown,
    pushState: vi.fn((state: unknown, _title: string, url: string) => {
      history.state = state;
      const [path = "", search = ""] = url.split("?");
      location.pathname = path;
      location.search = search ? `?${search}` : "";
    }),
    replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
      location.pathname = url;
      location.search = "";
    }),
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
  const popTo = (path: string) => {
    location.pathname = path;
    location.search = "";
    history.state = null;
    listeners.get("popstate")?.();
  };
  return { location, history, popTo };
});

import { installBrowserHistory } from "../../modules/platform/hooks/use-browser-history.js";
import { useStore } from "../../store.js";

// TEST_OVERVIEW: Browser Back or Forward out of a chat closes the docked artifact. With an unsaved edit it asks first: "Keep editing" puts the left URL and its history state back, "Discard" follows the browser. The /artifacts path opens the Artifacts page.

const settle = () => new Promise((resolve) => setTimeout(resolve));

function dirtyChat() {
  env.location.pathname = "/chat/a1";
  env.location.search = "?q=1";
  env.history.state = "in-app";
  const uninstall = installBrowserHistory();
  useStore.setState({ dialog: null });
  useStore.getState().setDock({ kind: "artifact", id: "art-1", edit: false });
  useStore.getState().setOpenArtifactDirty(true);
  return uninstall;
}

describe("browser history with an unsaved artifact edit", () => {
  // TEST_SCENARIO: Back with an unsaved edit asks, and "Keep editing" pushes the left URL with its search and state, keeping the chat and the artifact.
  it("restores the left entry when the user keeps editing", async () => {
    const uninstall = dirtyChat();
    env.history.pushState.mockClear();
    env.popTo("/");
    expect(useStore.getState().dialog?.open).toBe(true);
    useStore.getState().closeDialog(false);
    await settle();
    expect(env.history.pushState).toHaveBeenCalledWith(
      "in-app",
      "",
      "/chat/a1?q=1",
    );
    expect(useStore.getState().view).toBe("chat");
    expect(useStore.getState().dock).toEqual({
      kind: "artifact",
      id: "art-1",
      edit: false,
    });
    uninstall();
  });

  // TEST_SCENARIO: a second Back while the question is open asks no second time.
  it("asks once while the question is open", async () => {
    const uninstall = dirtyChat();
    env.popTo("/");
    const first = useStore.getState().dialog;
    env.popTo("/settings");
    expect(useStore.getState().dialog).toBe(first);
    useStore.getState().closeDialog(true);
    await settle();
    expect(useStore.getState().view).toBe("settings");
    expect(useStore.getState().dock).toBeNull();
    uninstall();
  });
});

describe("the /artifacts path", () => {
  // TEST_SCENARIO: opening /artifacts lands on the Artifacts page, not on Home with a side panel.
  it("opens the Artifacts page", () => {
    env.location.pathname = "/artifacts";
    env.location.search = "";
    useStore.setState({ sidePanelTab: null });
    const uninstall = installBrowserHistory();
    expect(env.location.pathname).toBe("/artifacts");
    expect(useStore.getState().view).toBe("artifacts");
    expect(useStore.getState().sidePanelTab).toBeNull();
    uninstall();
  });
});
