// TEST_OVERVIEW: In the classic sidebar a click on an Agent row opens the Agent's Sessions under it, so the click always shows something: the Sessions the attention record holds, or "No sessions yet." when the record is whole and holds none, or More when the record is cut off. A hibernated Agent the user clicked stays out of See all, so a second click or Show less never moves it or the See all control.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { sidebarAgentFolded } from "../../modules/agents/lib/sidebar-agent-order.js";
import { SidebarAgentSessions } from "../../modules/sessions/components/sidebar-agent-sessions.js";

vi.hoisted(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

vi.mock("../../store.js", () => {
  const state = { view: "home" };
  return {
    useStore: Object.assign(
      (select: (s: unknown) => unknown) => select(state),
      { getState: () => state },
    ),
  };
});
vi.mock("../../modules/agents/hooks/use-act-when-awake.js", () => ({
  useActWhenAwake: () => () => {},
}));

function openedAgent(previewComplete: boolean) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SidebarAgentSessions, {
        agentId: "a-1",
        open: false,
        shown: true,
        preview: [],
        previewComplete,
        conversationOf: () => undefined,
        stickyClassName: "",
      }),
    ),
  );
}

describe("a click on an Agent with no Sessions in the attention record", () => {
  // TEST_SCENARIO: the user clicks an Agent that has no Session in the whole attention record; the row opens to "No sessions yet." instead of showing nothing.
  it("shows No sessions yet when the record is whole", () => {
    expect(openedAgent(true)).toContain("No sessions yet.");
  });

  // TEST_SCENARIO: the attention record is cut off at its limit, so the Agent may have older Sessions; the row opens to More, which loads them.
  it("shows More when the record is cut off", () => {
    const out = openedAgent(false);
    expect(out).toContain('data-testid="sidebar-agent-sessions-toggle"');
    expect(out).not.toContain("No sessions yet.");
  });
});

describe("a hibernated Agent the user clicked", () => {
  const sleeping = { id: "a-1", state: "hibernated" } as const;

  // TEST_SCENARIO: the user opens a hibernated Agent from See all, then closes it again; it stays listed, so See all neither appears nor disappears under the pointer and Show less does not hide it.
  it("stays out of See all once opened, and after it is closed again", () => {
    expect(sidebarAgentFolded({}, sleeping, null)).toBe(true);
    expect(sidebarAgentFolded({ "a-1": true }, sleeping, null)).toBe(false);
    expect(sidebarAgentFolded({ "a-1": false }, sleeping, null)).toBe(false);
  });
});
