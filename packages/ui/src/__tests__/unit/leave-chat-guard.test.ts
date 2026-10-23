import { describe, expect, it, vi } from "vitest";

import { useStore } from "../../store.js";

vi.hoisted(() => {
  vi.stubGlobal("window", {
    location: { pathname: "/chat/a1", origin: "http://ui", search: "" },
    addEventListener: () => {},
  });
  vi.stubGlobal("history", { state: null, pushState: () => {} });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

// TEST_OVERVIEW: Leaving an Agent's chat closes the artifact docked beside it. When that artifact holds an unsaved edit, every way out of the chat asks first, and keeping the edit leaves the user where they were with the artifact still open.

function chatStore() {
  useStore.getState().resetChatContext();
  useStore.setState({ view: "chat", selectedAgent: "a1", dialog: null });
  useStore.getState().setDock({ kind: "artifact", id: "art-1" });
  return useStore;
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe("leaving the chat with a docked artifact", () => {
  // TEST_SCENARIO: with nothing unsaved, switching Agent closes the artifact at once, without a prompt.
  it("closes a clean artifact without asking", () => {
    const store = chatStore();
    store.getState().selectAgent("a2");
    expect(store.getState().dialog).toBeNull();
    expect(store.getState().selectedAgent).toBe("a2");
    expect(store.getState().dock).toBeNull();
  });

  // TEST_SCENARIO: a sidebar Agent click with an unsaved edit asks, and "Keep editing" stays in the same chat with the artifact still open.
  it("keeps an unsaved edit when the user cancels", async () => {
    const store = chatStore();
    store.getState().setOpenArtifactDirty(true);
    store.getState().selectAgent("a2");
    expect(store.getState().dialog?.open).toBe(true);
    store.getState().closeDialog(false);
    await settle();
    expect(store.getState().selectedAgent).toBe("a1");
    expect(store.getState().dock).toEqual({ kind: "artifact", id: "art-1" });
    expect(store.getState().openArtifactDirty).toBe(true);
  });

  // TEST_SCENARIO: leaving for another page asks the same question, and "Discard" closes the artifact and navigates.
  it("discards and leaves when the user confirms", async () => {
    const store = chatStore();
    store.getState().setOpenArtifactDirty(true);
    store.getState().setView("home");
    store.getState().closeDialog(true);
    await settle();
    expect(store.getState().view).toBe("home");
    expect(store.getState().dock).toBeNull();
  });
});
