import { createElement, Fragment, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionPairPicker } from "../../modules/sessions/components/session-pair-picker.js";

const state = vi.hoisted(() => ({
  models: {} as Record<
    string,
    { availableModels?: { value: string; name: string }[] | null }
  >,
  loading: false,
  operable: true,
  refetch: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({ nextSessionPair: {}, setNextSessionPair: vi.fn() }),
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
    owned: [],
  }),
  useGrantProvider: () => ({ grant: vi.fn(), pending: false }),
  useProviderModels: (_agent: string, _harness: string, provider: string) => ({
    data: state.models[provider],
    isFetching: state.loading,
    isError: false,
    operable: state.operable,
    refetch: state.refetch,
  }),
}));

function renderPicker() {
  return renderToStaticMarkup(
    createElement(SessionPairPicker, {
      agentId: "agent",
      defaultHarness: "pi",
      carried: [
        {
          name: "pi",
          harnessConfig: true,
          sessionModel: true,
          harnessConfigCatalog: {
            options: [
              {
                id: "model",
                name: "Model",
                category: "model",
                choices: [{ value: "static", name: "Static model" }],
              },
            ],
          },
        },
      ],
    }),
  );
}

describe("session pair model choices", () => {
  beforeEach(() => {
    state.models = {};
    state.loading = false;
    state.operable = true;
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
    expect(html).not.toContain("Static model");
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

  it("uses a harness catalog only when discovery is explicitly not configured", () => {
    state.models = { ibm: { availableModels: null } };
    expect(renderPicker()).toContain("Static model");
  });
});
