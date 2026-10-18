import { describe, expect, it, vi } from "vitest";

import { shownSessionId } from "../../modules/sessions/lib/shown-session.js";
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

// TEST_OVERVIEW: Opening a Session of another Agent from the sidebar highlights that Session row at once. The store holds the Session as pending until the chat view resumes it, and the sidebar must read the pending Session so the Agent row never lights up in between.

describe("opening another Agent's Session", () => {
  // TEST_SCENARIO: right after openAgentSession, before the chat view resumes it, the pending Session is the shown one, so the Agent row is not current.
  it("shows the pending Session before the chat view resumes it", () => {
    useStore.getState().resetChatContext();
    useStore.setState({ view: "chat", selectedAgent: "a1", sessionId: "s0" });
    useStore.getState().openAgentSession("a2", "s1");
    const s = useStore.getState();
    expect(s.selectedAgent).toBe("a2");
    expect(s.sessionId).toBeNull();
    expect(shownSessionId(s)).toBe("s1");
  });
});
