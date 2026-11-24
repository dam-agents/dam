// @vitest-environment happy-dom
// TEST_OVERVIEW: A profile made in Settings opens on the owner's default for new agents, so it runs what a new agent runs, and the name error clears once a name is typed.
import type { SessionPair } from "api-server-api";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  catalog: { harnesses: [{ name: "pi" }], defaultHarness: "pi" },
  default: {
    profileId: null as string | null,
    pair: null as SessionPair | null,
    base: null as SessionPair | null,
  },
  picker: null as {
    pair: SessionPair | null;
    defaultPair?: SessionPair | null;
    defaultHarness: string;
  } | null,
  create: vi.fn(),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { key?: string }) => ({
    data:
      options.key === "catalog"
        ? state.catalog
        : options.key === "default"
          ? state.default
          : undefined,
  }),
}));
vi.mock("../../trpc.js", () => ({
  trpc: {
    connections: { catalog: { queryOptions: () => ({ key: "catalog" }) } },
    profiles: {
      newAgentDefault: { queryOptions: () => ({ key: "default" }) },
    },
  },
}));
vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({ navigateToSettings: vi.fn() }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgents: () => ({}),
  findAgent: () => null,
}));
vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({ data: [], isPending: false }),
}));
vi.mock("../../modules/profiles/api/mutations.js", () => ({
  useCreateProfile: () => ({
    mutate: state.create,
    isPending: false,
    error: null,
  }),
  useUpdateProfile: () => ({}),
  useDeleteProfile: () => ({}),
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useProviderConnections: () => ({
    owned: [
      { id: "own", name: "CurveBender (own key)", type: "curve-bender" },
      {
        id: "shared",
        name: "CurveBender",
        type: "curve-bender",
        templateId: "curve-bender-deployment",
      },
    ],
  }),
}));
vi.mock("../../modules/sessions/components/session-model-picker.js", () => ({
  SessionModelPicker: (props: {
    pair: SessionPair | null;
    defaultPair?: SessionPair | null;
    defaultHarness: string;
  }) => {
    state.picker = props;
    return null;
  },
}));

await import("../../modules/profiles/api/queries.js");
const { ProfileSection } =
  await import("../../modules/profiles/components/profile-section.js");

const defaultPair: SessionPair = {
  harness: "pi",
  provider: "shared",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash",
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  state.default = { profileId: null, pair: null, base: defaultPair };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(ProfileSection)));
  act(() => button("New profile").click());
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  state.picker = null;
  vi.clearAllMocks();
});

const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
const input = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Profile name"]')!;
const type = (value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });

// TEST_SCENARIO: the panel opens on the default for new agents — its harness, provider and model — and saves it with one pick: a name.
it("opens on the owner's default for new agents", () => {
  expect(state.picker?.pair).toEqual(defaultPair);
  expect(state.picker?.defaultPair).toEqual(defaultPair);
  expect(state.picker?.defaultHarness).toBe("pi");
  type("Fast review");
  act(() => button("Save profile").click());
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Fast review",
      harness: "pi",
      providerTemplate: "curve-bender-deployment",
      model: defaultPair.model,
    }),
    expect.anything(),
  );
});

// TEST_SCENARIO: a default whose Connection the owner no longer holds gives way to the base default, so the panel never opens on a profile that cannot be saved.
it("falls back to the base default when the owner lost the Connection", () => {
  const base: SessionPair = {
    harness: "claude-code",
    provider: "own",
    model: "cb/aws/claude-opus-5-5",
  };
  state.default = {
    profileId: null,
    pair: { ...defaultPair, provider: "gone" },
    base,
  };
  act(() => root.render(createElement(ProfileSection)));
  act(() => button("New profile").click());
  expect(state.picker?.pair).toEqual(base);
});

// TEST_SCENARIO: the name error is shown on Save and clears the moment a name is typed, so it never outlives what it asks for.
it("clears the name error once a name is typed", () => {
  const dialog = () => document.querySelector('[role="dialog"]')?.textContent;
  act(() => button("Save profile").click());
  expect(dialog()).toContain("Give the profile a name.");
  type("Fast review");
  expect(dialog()).not.toContain("Give the profile a name.");
  expect(state.create).not.toHaveBeenCalled();
});
