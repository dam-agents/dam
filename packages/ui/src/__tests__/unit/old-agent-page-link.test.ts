import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const location = {
    pathname: "/",
    search: "",
    hash: "",
    origin: "http://ui",
  };
  const history = {
    state: null as unknown,
    pushState: vi.fn(),
    replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
      const [beforeHash = "", hash = ""] = url.split("#");
      location.pathname = beforeHash;
      location.hash = hash ? `#${hash}` : "";
    }),
  };
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", history);
  vi.stubGlobal("window", {
    location,
    history,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { location, history };
});

import { installBrowserHistory } from "../../modules/platform/hooks/use-browser-history.js";
import { useStore } from "../../store.js";

// TEST_OVERVIEW: There is no agent settings page any more, but the server still writes `/sandboxes/<id>/<section>` into Slack and Telegram messages and spend alerts, and people keep bookmarks to it. Opened in a fresh tab, such a link lands on the agent's chat with its settings modal on that section, never on Not found. The address becomes the chat's, keeping an #anchor the modal scrolls to, and the entry is replaced, so Back does not reopen the old link.

function open(path: string, hash = "") {
  env.location.pathname = path;
  env.location.hash = hash;
  env.history.replaceState.mockClear();
  useStore.setState({ agentSettings: null, selectedAgent: null });
  return installBrowserHistory();
}

describe("an old agent page link in a fresh tab", () => {
  // TEST_SCENARIO: each of the sections a message links to opens the chat with the modal on it, and the address becomes the chat's.
  it.each(["providers", "usage", "setup", "skills"] as const)(
    "opens the chat with settings on %s",
    (section) => {
      const uninstall = open(`/sandboxes/agent-a/${section}`);
      const state = useStore.getState();
      expect(state.view).toBe("chat");
      expect(state.selectedAgent).toBe("agent-a");
      expect(state.agentSettings).toEqual({ agentId: "agent-a", section });
      expect(env.location.pathname).toBe("/chat/agent-a");
      expect(env.history.replaceState).toHaveBeenCalledTimes(1);
      expect(env.history.pushState).not.toHaveBeenCalled();
      uninstall();
    },
  );

  // TEST_SCENARIO: a bare agent link opens General, and the agent-unavailable overlay's #enable-agent anchor survives the move, so the modal can scroll to the Enable button.
  it("opens General and keeps the anchor", () => {
    const uninstall = open("/sandboxes/agent-a", "#enable-agent");
    expect(useStore.getState().agentSettings).toEqual({
      agentId: "agent-a",
      section: "setup",
    });
    expect(env.location.pathname).toBe("/chat/agent-a");
    expect(env.location.hash).toBe("#enable-agent");
    uninstall();
  });

  // TEST_SCENARIO: an ordinary chat link opens no settings and rewrites no address.
  it("leaves a chat link alone", () => {
    const uninstall = open("/chat/agent-a");
    expect(useStore.getState().agentSettings).toBeNull();
    expect(env.history.replaceState).not.toHaveBeenCalled();
    uninstall();
  });
});
