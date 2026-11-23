// @vitest-environment happy-dom
// TEST_OVERVIEW: a chat whose channel dropped while its tab sat in the background reconnects the moment the tab comes back to the front, instead of waiting out a backoff the background tab throttled; a tab still in the background keeps the backoff.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useAcpConnection } from "../../modules/sessions/hooks/use-acp-connection.js";
import { createPromptDelivery } from "../../modules/sessions/lib/prompt-delivery.js";

const h = vi.hoisted(() => ({
  sockets: [] as (EventTarget & { readyState: number })[],
  state: {
    sessionId: "s-1" as string | null,
    selectedAgent: "agent",
    drafts: {},
  },
}));
vi.mock("../../store.js", () => ({ useStore: { getState: () => h.state } }));
vi.mock("../../query-client.js", () => ({
  queryClient: { invalidateQueries: async () => {} },
}));
vi.mock("../../modules/sessions/api/queries.js", () => ({
  seedStartedSession: () => {},
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  settledNextSessionPair: async () => null,
}));
vi.mock("../../modules/acp/acp.js", () => ({
  sessionForksIn: () => false,
  sessionSteeringIn: () => null,
  openInitializedConnection: async () => {
    const ws = Object.assign(new EventTarget(), {
      readyState: 1,
      close() {
        this.readyState = 3;
      },
    });
    h.sockets.push(ws);
    // A reconnect's socket never finishes opening, so the test sees the attempt and nothing after it.
    if (h.sockets.length > 1) await new Promise(() => {});
    return {
      connection: { agent: { request: async () => ({}) } },
      ws,
      forksSessions: false,
    };
  },
}));

let visibility: DocumentVisibilityState = "visible";
let root: Root;
const props = {
  selectedAgent: "agent",
  sessionId: "s-1",
  sessionMode: null,
  liveBlocked: false,
  agentOperable: true,
  makeUpdateHandler: () => () => {},
  engage: async () => "s-1",
  bindEngagement: () => {},
  clearEngagement: () => {},
  setMessages: () => {},
  delivery: createPromptDelivery(),
};
function Chat() {
  useAcpConnection(props);
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function dropChannel(): Promise<void> {
  act(() => {
    h.sockets[0]!.readyState = 3;
    h.sockets[0]!.dispatchEvent(new Event("close"));
  });
  await flush();
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  h.sockets = [];
  h.state.sessionId = "s-1";
  visibility = "visible";
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => {
    root.render(createElement(Chat));
  });
  await flush();
  expect(h.sockets).toHaveLength(1);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

// TEST_SCENARIO: the channel dropped in a background tab and its reconnect waits out the backoff; bringing the tab to the front opens the new connection at once.
it("reconnects at once when the tab comes back to the front", async () => {
  setVisibility("hidden");
  await dropChannel();
  expect(h.sockets).toHaveLength(1);

  setVisibility("visible");
  await flush();
  expect(h.sockets).toHaveLength(2);
});

// TEST_SCENARIO: the control case, a tab that stays in the background, keeps the backoff and opens nothing before it ends.
it("keeps the backoff while the tab stays in the background", async () => {
  setVisibility("hidden");
  await dropChannel();
  setVisibility("hidden");
  await flush();
  expect(h.sockets).toHaveLength(1);
});

// TEST_SCENARIO: a tab coming to the front with a live channel opens no second connection.
it("leaves a live channel alone", async () => {
  setVisibility("hidden");
  setVisibility("visible");
  await flush();
  expect(h.sockets).toHaveLength(1);
});
