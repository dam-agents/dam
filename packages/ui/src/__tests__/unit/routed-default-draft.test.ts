import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";

type Pair = {
  harness: string;
  provider: string | null;
  model: string | null;
  settings?: Record<string, string>;
};

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));
const state = vi.hoisted(() => ({
  draft: null as unknown,
  saved: [] as unknown[],
  remembered: {
    harness: "codex",
    provider: "oai",
    model: "openai/gpt-5.5",
  } as unknown,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual("react")),
  useState: () => [
    state.draft,
    (value: unknown) => {
      state.draft = value;
    },
  ],
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ navigateToSettings: () => {}, showConfirm: () => {} }),
}));
vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => true,
}));
vi.mock("../../modules/agents/hooks/use-root-driver.js", () => ({
  useRootDriver: () => null,
}));
vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: {
      modelRouter: true,
      defaultHarness: "codex",
      harnesses: [
        { name: "codex", sessionModel: true },
        { name: "pi", sessionModel: true },
      ],
    },
  }),
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({
    data: {
      harnesses: [
        { name: "codex", displayName: "Codex", providers: ["openai"] },
        { name: "pi", displayName: "Pi", providers: ["openai"] },
      ],
    },
  }),
  useRememberedPair: () => ({ data: state.remembered }),
  useProviderConnections: () => ({
    granted: [{ id: "oai", name: "OpenAI", type: "openai" }],
    owned: [],
    loaded: true,
  }),
  useGrantProvider: () => ({}),
  useProviderModels: () => ({}),
  useHarnessCatalogModels: () => ({}),
  rememberSessionPair: (_id: string, pair: unknown) => {
    state.saved.push(pair);
    state.remembered = pair;
  },
}));

const { SandboxProvidersSection } =
  await import("../../modules/sandboxes/components/sandbox-providers-section.js");

type Element = ReactElement<{
  children: unknown[];
  defaultPair: { value: Pair; onChoose: (pair: Pair) => void };
}>;

const renderDefault = () => {
  const page = SandboxProvidersSection({
    agentId: "a",
    header: () => null,
  }) as Element;
  const editor = page.props.children[
    page.props.children.length - 1
  ] as ReactElement;
  const tree = (editor.type as (props: unknown) => Element)(editor.props);
  const body = tree.props.children[1] as Element;
  return (body.props.children[0] as Element).props.defaultPair;
};

// TEST_SCENARIO: on a routed runtime a harness picked in the new layout's default editor waits for its model; settings picked meanwhile stay with the draft and are saved with the model.
it("keeps settings picked while a routed harness waits for its model", () => {
  renderDefault().onChoose({ harness: "pi", provider: null, model: null });
  renderDefault().onChoose({
    ...renderDefault().value,
    settings: { effort: "high" },
  });
  expect(state.saved).toEqual([]);
  expect(renderDefault().value.settings).toEqual({ effort: "high" });
  renderDefault().onChoose({
    ...renderDefault().value,
    provider: "oai",
    model: "openai/gpt-5.5",
  });
  expect(state.saved).toEqual([
    {
      harness: "pi",
      provider: "oai",
      model: "openai/gpt-5.5",
      settings: { effort: "high" },
    },
  ]);
});
