// @vitest-environment happy-dom
import { SessionType } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOpenInitializationSession } from "../../modules/sessions/hooks/use-open-initialization-session.js";
import { useStore } from "../../store.js";

// TEST_OVERVIEW: an Agent's idle chat opens its initialization session on its own while that session is the Agent's newest, unless the user asked for a new session of that Agent, which keeps the chat on the new-session page.

vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => true,
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  useAgentSessionQuery: () => ({
    data: [
      { sessionId: "init", initialization: true, type: SessionType.Regular },
    ],
  }),
}));

function mount(resumeSession: (id: string) => void) {
  const root = createRoot(document.createElement("div"));
  function Probe() {
    useOpenInitializationSession({
      agentId: "a1",
      active: true,
      idle: true,
      resumeSession,
    });
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return root;
}

afterEach(() => useStore.getState().markNewSession(null));

describe("opening the initialization session", () => {
  // TEST_SCENARIO: a plain open of the Agent's chat opens its initialization session.
  it("opens it on a plain open of the chat", () => {
    const resume = vi.fn();
    const root = mount(resume);
    expect(resume).toHaveBeenCalledWith("init");
    act(() => root.unmount());
  });

  // TEST_SCENARIO: after New session for that Agent the chat stays on the new-session page, and the request is used up.
  it("stays on the new-session page after New session", () => {
    useStore.getState().markNewSession("a1");
    const resume = vi.fn();
    const root = mount(resume);
    expect(resume).not.toHaveBeenCalled();
    expect(useStore.getState().newSessionAgent).toBeNull();
    act(() => root.unmount());
  });
});
