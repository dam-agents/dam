// @vitest-environment happy-dom
// TEST_OVERVIEW: A wake or restart marks its Agent as restarting until the Agent is back, and the mark keeps the Agent's views from talking to it. The mark ends at the first read that shows the Agent running after it was seen down. An Agent woken from sleep is already down when the wake starts, so its first running read ends the mark, even when no read in between shows it starting.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useRestartingAction } from "../../modules/agents/hooks/use-restarting-action.js";
import { transitionRestartingAgents } from "../../modules/agents/store.js";
import { useStore } from "../../store.js";
import type { AgentView } from "../../types.js";

const fake = vi.hoisted(() => ({ agents: [] as unknown[] }));
vi.mock("../../modules/agents/api/queries.js", () => ({
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
