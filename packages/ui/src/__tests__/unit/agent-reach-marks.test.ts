// @vitest-environment happy-dom
// TEST_OVERVIEW: Two marks in the browser keep an Agent's views from talking to it: restarting, set by a wake or a restart, and unreachable, set when the Agent's socket closes. Neither may outlive its reason. The restarting mark ends at the first read that shows the Agent running after it was seen down; an Agent woken from sleep is already down when the wake starts, so its first running read ends the mark, even when no read in between shows it starting. Only a socket that opens again ends the unreachable mark, so a session list that waits for its Agent waits for it to run, not for that mark, and its next ask opens the socket.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  agentsKeys,
  untilAgentOperable,
} from "../../modules/agents/api/queries.js";
import { useRestartingAction } from "../../modules/agents/hooks/use-restarting-action.js";
import { transitionRestartingAgents } from "../../modules/agents/store.js";
import { queryClient } from "../../query-client.js";
import { useStore } from "../../store.js";
import type { AgentView } from "../../types.js";

const fake = vi.hoisted(() => ({ agents: [] as unknown[] }));
vi.mock("../../modules/agents/api/queries.js", async (original) => ({
  ...(await original<object>()),
  useAgentsList: () => fake.agents,
}));

const withState = (state: AgentView["state"]) =>
  ({ id: "a-1", state, overBudget: false }) as AgentView;

function actionFor(state: AgentView["state"]): (id: string) => void {
  fake.agents = [withState(state)];
  let action: ((id: string) => void) | undefined;
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      createElement(() => {
        action = useRestartingAction(() => new Promise(() => {}));
        return null;
      }),
    ),
  );
  act(() => root.unmount());
  return action!;
}

// TEST_SCENARIO: the user opens a sleeping Agent's list, which wakes it; the Agent starts quickly, so the next read of the Agents list already shows it running; the mark ends there, and the list can load.
it("ends a wake's mark at the first running read", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  actionFor("hibernated")("a-1");
  const marks = useStore.getState().restartingAgents;
  expect(marks.has("a-1")).toBe(true);
  expect(
    transitionRestartingAgents(marks, [withState("running")]).has("a-1"),
  ).toBe(false);
});

// TEST_SCENARIO: the user restarts a running Agent; the next read can still show it running before it goes down, so that read keeps the mark.
it("keeps a restart's mark until the Agent was seen down", () => {
  actionFor("running")("a-1");
  const marks = useStore.getState().restartingAgents;
  expect(
    transitionRestartingAgents(marks, [withState("running")]).has("a-1"),
  ).toBe(true);
});

// TEST_SCENARIO: the session list's first ask reaches its Agent as the Agent comes up, the socket closes, and the Agent is marked unreachable; the sidebar is the only view on that Agent, so no other ask opens the socket again. The list's wait ends once the Agent runs, mark or not, so its ask goes out again. A held prompt still waits for the socket.
it("lets a session list ask again while its running Agent is marked unreachable", async () => {
  const setAgent = (state: AgentView["state"]) =>
    queryClient.setQueryData(agentsKeys.listWithChannels(), {
      list: [withState(state)],
    });
  useStore.getState().clearRestartingAgent("a-1");
  setAgent("starting");
  useStore.getState().markAgentUnreachable("a-1");
  const waiting = untilAgentOperable("a-1", { evenUnreachable: true });
  expect(waiting).not.toBeNull();
  setAgent("running");
  await expect(waiting).resolves.toBeUndefined();
  expect(untilAgentOperable("a-1")).not.toBeNull();
});
