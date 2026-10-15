import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { SandboxProvidersSection } from "../../modules/sandboxes/components/sandbox-providers-section.js";

const state = vi.hoisted(() => ({
  remembered: null as {
    harness: string;
    provider: string | null;
    model: string | null;
  } | null,
  routed: false,
  saved: [] as unknown[],
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({ navigateToSettings: vi.fn(), showConfirm: vi.fn() }),
}));

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: {
      modelRouter: state.routed,
      defaultHarness: "codex",
      harnesses: [
        {
          name: "pi",
          harnessConfig: true,
          sessionModel: true,
          sessionSettings: [],
        },
        {
          name: "codex",
          harnessConfig: true,
          sessionModel: true,
          sessionSettings: [],
        },
        {
          name: "bob",
          harnessConfig: true,
          sessionModel: true,
          sessionSettings: [],
        },
      ],
    },
  }),
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({
    data: {
      harnesses: [
        { name: "pi", displayName: "Pi", providers: ["openai"] },
        { name: "codex", displayName: "Codex", providers: ["openai"] },
        { name: "bob", displayName: "Bob", providers: ["bob"] },
      ],
    },
  }),
  useRememberedPair: () => ({ data: state.remembered }),
  useProviderConnections: () => {
    const openai = { id: "oai", name: "OpenAI", type: "openai" };
    return { granted: [openai], owned: [openai], loaded: true };
  },
  useGrantProvider: () => ({ grant: vi.fn(), revoke: vi.fn(), pending: false }),
  useProviderModels: () => ({
    data: { availableModels: [{ value: "gpt", name: "GPT" }] },
  }),
  useHarnessCatalogModels: () => ({
    data: state.routed
      ? {
          harness: "codex",
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
        }
      : undefined,
  }),
  rememberSessionPair: (_agent: string, pair: unknown) =>
    state.saved.push(pair),
}));

describe("agent default session pair", () => {
  // TEST_SCENARIO: With no remembered pair the picker shows the agent's default harness on its first fitting provider, not the first harness listed.
  it("starts on the agent's default harness when nothing is remembered", () => {
    state.remembered = null;
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxProvidersSection, { agentId: "agent" }),
      ),
    );
    expect(html).toMatch(/aria-label="Harness"[^>]*><span[^>]*>Codex</);
    expect(html).toMatch(/aria-label="Provider"[^>]*><span[^>]*>OpenAI</);
  });

  it("shows the remembered pair", () => {
    state.remembered = { harness: "pi", provider: "oai", model: "gpt" };
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxProvidersSection, { agentId: "agent" }),
      ),
    );
    expect(html).toMatch(/aria-label="Harness"[^>]*><span[^>]*>Pi</);
    expect(html).toMatch(/aria-label="Model"[^>]*><span[^>]*>GPT</);
  });
});

describe("agent default on a runtime that routes by model name", () => {
  /** TEST_SCENARIO: The default model is picked from the harness's catalog
   * across providers as a qualified name; the provider follows the model, so
   * no provider picker is shown. */
  it("offers qualified names and no provider picker", () => {
    state.routed = true;
    state.remembered = {
      harness: "codex",
      provider: "oai",
      model: "openai/gpt-5.5",
    };
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxProvidersSection, { agentId: "agent" }),
      ),
    );
    expect(html).toMatch(
      /aria-label="Model"[^>]*><span[^>]*>gpt-5.5 · OpenAI</,
    );
    expect(html).not.toContain('aria-label="Provider"');
    state.routed = false;
  });
});
