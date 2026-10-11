import type { HarnessCapability } from "agent-runtime-api";
import { createElement, Fragment, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModelIndicator } from "../../modules/sessions/components/model-indicator.js";
import { SessionPairPicker } from "../../modules/sessions/components/session-pair-picker.js";

const carried: HarnessCapability[] = [
  {
    name: "pi",
    harnessConfig: true,
    sessionModel: true,
    sessionSettings: ["mode"],
    harnessConfigCatalog: {
      options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          choices: [{ value: "static", name: "Static model" }],
        },
        {
          id: "mode",
          name: "Thinking",
          category: "mode",
          choices: [{ value: "high", name: "High" }],
        },
      ],
    },
  },
];

const state = vi.hoisted(() => ({
  models: {} as Record<
    string,
    { availableModels?: { value: string; name: string }[] | null }
  >,
  loading: false,
  fetching: false,
  operable: true,
  refetch: vi.fn(),
  providersAsked: [] as string[],
  owned: [] as { id: string; name: string; type: string }[],
  navigateToSettings: vi.fn(),
  newSession: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({
      nextSessionPair: {},
      setNextSessionPair: vi.fn(),
      navigateToSettings: state.navigateToSettings,
    }),
}));

vi.mock("@/components/ui/popover", () => {
  const passthrough = ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children);
  return {
    Popover: passthrough,
    PopoverTrigger: passthrough,
    PopoverContent: passthrough,
    PopoverClose: passthrough,
  };
});

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({
    data: {
      harnesses: [
        {
          name: "pi",
          displayName: "Pi",
          providers: ["ibm-litellm", "curve-bender"],
        },
      ],
    },
  }),
  useRememberedPair: () => ({
    data: { harness: "pi", provider: "ibm", model: null },
  }),
  useProviderConnections: () => ({
    granted: [
      { id: "ibm", name: "IBM", type: "ibm-litellm" },
      { id: "curve", name: "Curve", type: "curve-bender" },
    ],
    owned: [
      { id: "ibm", name: "IBM", type: "ibm-litellm" },
      { id: "curve", name: "Curve", type: "curve-bender" },
      ...state.owned,
    ],
  }),
  useGrantProvider: () => ({
    grant: vi.fn(),
    revoke: vi.fn(),
    pending: false,
  }),
  rememberSessionPair: vi.fn(),
  useProviderModels: (_agent: string, _harness: string, provider: string) => {
    state.providersAsked.push(provider);
    return {
      data: state.models[provider],
      isLoading: state.loading,
      isFetching: state.loading || state.fetching,
      isError: false,
      operable: state.operable,
      refetch: state.refetch,
    };
  },
}));

function renderPicker() {
  return renderToStaticMarkup(
    createElement(SessionPairPicker, {
      agentId: "agent",
      defaultHarness: "pi",
      carried,
    }),
  );
}

describe("session pair model choices", () => {
  beforeEach(() => {
    state.models = {};
    state.loading = false;
    state.fetching = false;
    state.operable = true;
    state.providersAsked = [];
    state.owned = [];
  });

  it("lists each provider's models without a default-model choice", () => {
    state.models = {
      ibm: { availableModels: [{ value: "ibm-model", name: "IBM model" }] },
      curve: {
        availableModels: [{ value: "curve-model", name: "Curve model" }],
      },
    };
    const html = renderPicker();
    expect(html).toContain("IBM model");
    expect(html).toContain("Curve model");
    expect(html).not.toMatch(/default model/i);
    expect(html).not.toContain("choose a model");
    expect(html).not.toContain("Static model");
    expect(html).not.toContain("New session runs on");
    expect(html).not.toContain('aria-label="Close"');
    expect(html).toContain("Connect providers");
    expect(html).toMatch(/disabled=""[^>]*>Default<\/button>/);
    expect(html).not.toContain("Configure defaults");
    expect(html).toContain('aria-label="Disconnect IBM"');
    expect(html).toContain('aria-label="Session settings"');
    expect(html).toContain("Harness default");
  });

  it("lists unattached providers in place with an attach action", () => {
    state.owned = [{ id: "other", name: "Other", type: "curve-bender" }];
    const html = renderPicker();
    expect(html.indexOf("IBM")).toBeLessThan(html.indexOf("Other"));
    expect(html).toContain("Attach this provider");
    expect(state.providersAsked).not.toContain("other");
  });

  it("reports unavailable discovery instead of substituting defaults or catalog models", () => {
    state.models = { ibm: {}, curve: { availableModels: [] } };
    const html = renderPicker();
    expect(html).toContain("Could not list this provider&#x27;s models.");
    expect(html).toContain("Retry");
    expect(html).toContain("No models available.");
    expect(html).not.toContain("Static model");
    expect(html).not.toMatch(/default model/i);
  });

  it("shows loading and stopped states without selectable placeholders", () => {
    state.loading = true;
    expect(renderPicker()).toContain("Loading models…");
    state.operable = false;
    expect(renderPicker()).toContain(
      "Start the agent to list this provider&#x27;s models.",
    );
  });

  it("keeps failure, empty state and Retry visible during background polls", () => {
    state.models = { ibm: {}, curve: { availableModels: [] } };
    const before = renderPicker();
    state.fetching = true;
    expect(renderPicker()).toBe(before);
    expect(before).toContain("Retry");
    expect(before).toContain("No models available.");
    expect(before).not.toContain("Loading models…");
  });

  it.each([
    { availableModels: null, expected: "Static model" },
    { availableModels: [], expected: "No models available." },
    {
      availableModels: undefined,
      expected: "Could not list this provider&#x27;s models.",
    },
  ])(
    "renders the active provider with $expected during background polls",
    ({ availableModels, expected }) => {
      state.models = { curve: { availableModels } };
      state.fetching = true;
      const html = renderToStaticMarkup(
        createElement(ModelIndicator, {
          agentId: "agent",
          harness: "pi",
          provider: "curve",
          model: "static",
          carried,
          onChoose: vi.fn(),
          onConfigure: vi.fn(),
          onNewSession: state.newSession,
        }),
      );
      expect(html).toContain(expected);
      expect(html).not.toContain("Loading models…");
      expect(state.providersAsked).toEqual(["curve"]);
      expect(html).not.toContain("IBM");
      expect(html).not.toContain("Current model");
      expect(html).not.toContain("Configure model");
      expect(html).not.toContain("Connect providers");
      expect(html).not.toContain('aria-label="Close"');
      expect(html).toContain("Other harnesses and models need a");
      expect(html).toContain("new session</button>");
      if (availableModels !== null) expect(html).not.toContain("Static model");
    },
  );

  it("uses a harness catalog only when discovery is explicitly not configured", () => {
    state.models = { ibm: { availableModels: null } };
    expect(renderPicker()).toContain("Static model");
  });
});
