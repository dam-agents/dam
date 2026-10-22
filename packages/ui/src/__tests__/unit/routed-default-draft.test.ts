import { expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));
const state = vi.hoisted(() => ({
  draft: null as unknown,
  saved: [] as unknown[],
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
vi.mock("../../modules/sessions/hooks/use-provider-usage.js", () => ({
  useProviderUsage: () => () => ({ kinds: [], schedules: [] }),
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
  useProviderConnections: () => ({
    granted: [{ id: "oai", name: "OpenAI", type: "openai" }],
    owned: [],
    loaded: true,
  }),
  useProviderModels: () => ({ data: { availableModels: [] } }),
  useHarnessCatalogModels: () => ({
    data: {
      harness: "pi",
      routed: true,
      providers: [
        {
          connectionId: "oai",
          alias: "openai",
          template: "openai",
          displayName: "OpenAI",
          status: "listed",
          listedAt: null,
          models: [
            {
              name: "openai/gpt-5.5",
              upstreamId: "gpt-5.5",
              contextWindow: null,
              maxOutputTokens: null,
              reasoning: null,
              vision: null,
              prices: null,
              source: { limits: "none", prices: "none" },
            },
          ],
        },
      ],
    },
  }),
  useHarnessConfigured: () => undefined,
  rememberSessionPair: (_agent: string, pair: unknown) => {
    state.saved.push(pair);
  },
}));

const { DefaultPairEditor } =
  await import("../../modules/sandboxes/components/default-pair-editor.js");

interface Node {
  props: {
    title?: string;
    onSelect?: (id: string | null) => void;
    children?: unknown;
  };
}

const onSelect = (node: unknown): ((id: string | null) => void) | undefined => {
  if (typeof node !== "object" || node === null) return undefined;
  const { props } = node as Node;
  if (props.onSelect) return props.onSelect;
  return ([] as unknown[])
    .concat(props.children ?? [])
    .map(onSelect)
    .find((found) => found !== undefined);
};

const pick = (title: string) => {
  const editor = DefaultPairEditor({
    agentId: "a",
    kind: "chat",
    current: {
      harness: "codex",
      provider: "oai",
      model: "openai/gpt-5.5",
    },
  }) as unknown as Node;
  const field = ([] as Node[])
    .concat(editor.props.children as Node[])
    .find((child) => child?.props?.title === title)!;
  return onSelect(field)!;
};

// TEST_SCENARIO: on a routed runtime a default is saved only with a model, so a harness picked in the editor waits for its model, and that model saves the pair.
it("waits for a model before saving a routed harness pick", () => {
  pick("Harness")("pi");
  expect(state.saved).toEqual([]);
  pick("Model")("openai/gpt-5.5");
  expect(state.saved).toEqual([
    { harness: "pi", provider: "oai", model: "openai/gpt-5.5" },
  ]);
});
