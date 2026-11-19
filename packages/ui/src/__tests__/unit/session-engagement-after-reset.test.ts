// @vitest-environment happy-dom
// TEST_OVERVIEW: the chat's connection is engaged to the session on screen, and to no other. A session/resume that answers after the chat moved to another session never binds the connection to the old one, so a message sent right after opening a session, and its Retry, go to the session the person sees. A binding left on another session is replaced by the shown one at the next send.
import type { ClientConnection } from "@agentclientprotocol/sdk";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAcpSessionEngagement } from "../../modules/sessions/hooks/use-acp-session-engagement.js";

const h = vi.hoisted(() => ({
  state: { sessionId: "s1" as string | null },
}));

vi.mock("../../store.js", () => ({
  useStore: Object.assign(
    (select: (s: typeof h.state) => unknown) => select(h.state),
    { getState: () => h.state },
  ),
}));

interface FakeConnection {
  resumed: string[];
  answer: () => void;
  connection: ClientConnection;
}

function fakeConnection(): FakeConnection {
  const resumed: string[] = [];
  const pending: (() => void)[] = [];
  const connection = {
    agent: {
      request: (method: string, params: { sessionId: string }) => {
        if (method === "session/resume") resumed.push(params.sessionId);
        return new Promise<void>((resolve) => pending.push(resolve));
      },
    },
  } as unknown as ClientConnection;
  return {
    resumed,
    answer: () => {
      for (const resolve of pending.splice(0)) resolve();
    },
    connection,
  };
}

let root: Root;
let engagement: ReturnType<typeof useAcpSessionEngagement>;

function TestChat() {
  engagement = useAcpSessionEngagement("agent");
  return null;
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  h.state.sessionId = "s1";
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(TestChat)));
});

afterEach(() => act(() => root.unmount()));

describe("the chat's engagement", () => {
  // TEST_SCENARIO: the chat resumes s1, and the person opens s2 before the resume answers: the reset clears the engagement. The late answer does not bind s1, and the next engage resumes and returns s2.
  it("is not bound by a resume that answers after a reset", async () => {
    const old = fakeConnection();
    const first = engagement.engage(old.connection);
    expect(old.resumed).toEqual(["s1"]);

    engagement.clear();
    h.state.sessionId = "s2";
    old.answer();

    await expect(first).resolves.toBeNull();
    expect(engagement.engagedSessionIdRef.current).toBeNull();

    const fresh = fakeConnection();
    const next = engagement.engage(fresh.connection);
    expect(fresh.resumed).toEqual(["s2"]);
    fresh.answer();
    await expect(next).resolves.toBe("s2");
    expect(engagement.engagedSessionIdRef.current).toBe("s2");
  });

  // TEST_SCENARIO: the engagement is still on s1 while s2 is on screen. The next engage, as a send or its Retry makes, resumes s2 on the connection and returns s2, with no switch away and back.
  it("moves to the shown session when bound to another one", async () => {
    engagement.bind("s1");
    h.state.sessionId = "s2";

    const live = fakeConnection();
    const engaged = engagement.engage(live.connection);
    expect(live.resumed).toEqual(["s2"]);
    live.answer();

    await expect(engaged).resolves.toBe("s2");
    expect(engagement.engagedSessionIdRef.current).toBe("s2");
  });

  // TEST_SCENARIO: the engagement is on the session on screen, so engage returns it at once and resumes nothing.
  it("returns the shown session at once when bound to it", async () => {
    engagement.bind("s1");

    const live = fakeConnection();
    await expect(engagement.engage(live.connection)).resolves.toBe("s1");
    expect(live.resumed).toEqual([]);
  });
});
