// @vitest-environment happy-dom
// TEST_OVERVIEW: Settings › Providers picks the owner's default for new agents with the agent config's picker: it shows the owner's choice, else the base default, and a pick saves a profile reference or the values it runs on; a harness picked without a model saves nothing yet.
import type {
  NewAgentDefaultView,
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

interface Target {
  slots: SessionChoiceSlots;
  onChoose: (
    pair: SessionPair,
    references: SessionChoiceReferences,
    effective?: SessionPair,
  ) => void | Promise<boolean>;
}

const state = vi.hoisted(() => ({
  view: null as NewAgentDefaultView | null,
  target: null as Target | null,
  saved: [] as unknown[],
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { key: string }) => ({
    data:
      options.key === "catalog"
        ? {
            harnesses: [{ name: "pi" }],
            defaultHarness: "pi",
            modelRouter: true,
          }
        : state.view,
  }),
}));
vi.mock("../../trpc.js", () => ({
  trpc: {
    connections: { catalog: { queryOptions: () => ({ key: "catalog" }) } },
    profiles: { newAgentDefault: { queryOptions: () => ({ key: "default" }) } },
  },
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select({}),
}));
vi.mock("../../modules/profiles/api/mutations.js", () => ({
  useSetNewAgentDefault: () => ({
    mutateAsync: async (input: unknown) => void state.saved.push(input),
  }),
}));
vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({
  SessionPairPicker: ({ target }: { target: Target }) => {
    state.target = target;
    return null;
  },
}));

const { NewAgentDefaultPicker } =
  await import("../../modules/profiles/components/new-agent-default-picker.js");

const BASE = { harness: "pi", provider: "conn-shared", model: "cb/deepseek" };
let root: Root | null = null;
const render = (view: NewAgentDefaultView) => {
  state.view = view;
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(createElement(NewAgentDefaultPicker)));
  return state.target!;
};
afterEach(() => {
  act(() => root?.unmount());
  state.saved = [];
});

/** TEST_SCENARIO: an owner who chose nothing sees the base default as the pick; a profile pick saves its reference alone. */
it("shows the base default and saves a profile by reference", async () => {
  const target = render({ profileId: null, pair: null, base: BASE });
  expect(target.slots).toMatchObject({ profileId: null, pair: BASE });
  await act(async () => {
    await target.onChoose(BASE, { profileId: "profile-1" });
  });
  expect(state.saved).toEqual([{ profileId: "profile-1" }]);
});

/** TEST_SCENARIO: a Custom pick saves the values a run shows (the effective pair); a harness with no model yet saves nothing. */
it("saves the owner's own values once they name a model", async () => {
  const target = render({ profileId: null, pair: BASE, base: BASE });
  const own = { harness: "pi", provider: "conn-own", model: "own/model" };
  await act(async () => {
    await target.onChoose({ ...own, model: null }, { profileId: null });
  });
  expect(state.saved).toEqual([]);
  await act(async () => {
    await target.onChoose(own, { profileId: null }, own);
  });
  expect(state.saved).toEqual([{ pair: own }]);
});
