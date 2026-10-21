import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { SandboxProvidersSection } from "../../modules/sandboxes/components/sandbox-providers-section.js";

const state = vi.hoisted(() => ({
  remembered: null as {
    harness: string;
    provider: string | null;
    model: string | null;
  } | null,
  routed: false,
  operable: true,
  comingUp: false,
  hasRun: true,
  saved: [] as unknown[],
  newLayout: false,
  picker: null as Record<string, unknown> | null,
}));

vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => state.newLayout,
}));
vi.mock("../../modules/agents/components/default-model-notice.js", () => ({
  DefaultModelNotice: () => null,
}));
vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({
  SessionPairPicker: (props: Record<string, unknown>) => {
    state.picker = props;
    return null;
  },
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
      harnesses: !state.hasRun
        ? null
        : [
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

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgents: () => ({ data: { list: [] }, isPending: false }),
  useIsAgentOperable: () => state.operable,
}));

vi.mock("../../modules/agents/hooks/use-operable-state.js", () => ({
  useOperableState: () => ({
    operable: state.operable,
    comingUp: state.comingUp,
  }),
}));

vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake: vi.fn(), isPending: false }),
}));

vi.mock("../../modules/spend/components/connection-spend-limit.js", () => ({
  ConnectionSpendLimit: () => null,
}));

vi.mock("../../modules/sessions/hooks/use-provider-usage.js", () => ({
  useProviderUsage: () => () => ({ kinds: [], schedules: [] }),
}));

vi.mock("../../modules/home/hooks/use-default-model-notices.js", () => ({
  useDefaultModelNotices: () => ({
    all: [],
    byAgentEvenDismissed: new Map(),
    waiting: [],
    dismiss: vi.fn(),
  }),
}));

vi.mock("../../modules/schedules/api/queries.js", () => ({
  useSchedules: () => ({ data: [] }),
}));

vi.mock("../../modules/schedules/api/mutations.js", () => ({
  useClearScheduleChoices: () => ({ mutate: vi.fn(), isPending: false }),
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
  clearSessionDefault: vi.fn(),
  useSessionDefaults: () => ({
    data: { chat: state.remembered, channel: null, scheduled: null },
  }),
  useHarnessConfigured: () => undefined,
}));

function renderSection() {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SandboxProvidersSection, {
        agentId: "agent",
        header: () => null,
      }),
    ),
  );
}

describe("agent default session pair", () => {
  // TEST_SCENARIO: With no remembered pair the picker shows the agent's default harness on its first fitting provider, not the first harness listed.
  it("starts on the agent's default harness when nothing is remembered", () => {
    state.remembered = null;
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxProvidersSection, {
          agentId: "agent",
          header: () => null,
        }),
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
        createElement(SandboxProvidersSection, {
          agentId: "agent",
          header: () => null,
        }),
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
        createElement(SandboxProvidersSection, {
          agentId: "agent",
          header: () => null,
        }),
      ),
    );
    expect(html).toMatch(
      /aria-label="Model"[^>]*><span[^>]*>gpt-5.5 · OpenAI</,
    );
    expect(html).not.toContain('aria-label="Provider"');
    state.routed = false;
  });
});

describe("JanUI's default editor", () => {
  // TEST_SCENARIO: with JanUI on, the Providers page edits the saved default with the new session's picker, in its default mode: it shows the saved pair, and a pick saves the whole pair, session settings included.
  it("hands the saved pair to the session picker, which saves each pick", () => {
    state.newLayout = true;
    state.routed = true;
    state.remembered = {
      harness: "codex",
      provider: "oai",
      model: "openai/gpt-5.5",
    };
    state.saved = [];
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxProvidersSection, {
          agentId: "agent",
          header: () => null,
        }),
      ),
    );
    expect(html).toContain("Default for new sessions");
    expect(html).not.toContain('aria-label="Harness"');
    const defaultPair = state.picker!.defaultPair as {
      value: unknown;
      onChoose: (pair: unknown) => void;
    };
    expect(defaultPair.value).toEqual(state.remembered);
    const pick = {
      harness: "codex",
      provider: "oai",
      model: "openai/gpt-5.5",
      settings: { effort: "high" },
    };
    defaultPair.onChoose(pick);
    expect(state.saved).toEqual([pick]);
    state.newLayout = false;
    state.routed = false;
  });

  // TEST_SCENARIO: on a routed runtime the server refuses a default with no model, so a harness picked in JanUI's default editor waits for its model instead of being saved.
  it("does not save a routed harness pick until its model is picked", () => {
    state.newLayout = true;
    state.routed = true;
    state.remembered = {
      harness: "codex",
      provider: "oai",
      model: "openai/gpt-5.5",
    };
    state.saved = [];
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxProvidersSection, {
          agentId: "agent",
          header: () => null,
        }),
      ),
    );
    const defaultPair = state.picker!.defaultPair as {
      onChoose: (pair: unknown) => void;
    };
    defaultPair.onChoose({ harness: "pi", provider: "oai", model: null });
    expect(state.saved).toEqual([]);
    state.newLayout = false;
    state.routed = false;
  });
});

describe("agent default model on a sleeping agent", () => {
  beforeEach(() => {
    state.routed = true;
    state.remembered = { harness: "codex", provider: "oai", model: null };
    state.operable = false;
    state.comingUp = false;
    state.hasRun = true;
  });

  afterEach(() => {
    state.routed = false;
    state.operable = true;
    state.comingUp = false;
    state.hasRun = true;
  });

  /** TEST_SCENARIO: The model list is read from the running agent, so while
   * the agent sleeps the Model field shows the start button in place of a
   * picker with nothing in it, and "Agent is starting…" once it is woken.
   * The harness stays pickable. */
  it("offers to start the agent instead of an empty model picker", () => {
    const asleep = renderSection();
    expect(asleep).toContain("Chat sessions");
    expect(asleep).toMatch(/aria-label="Harness"[^>]*><span[^>]*>Codex</);
    expect(asleep).toContain("Start agent to edit");
    expect(asleep).not.toContain('aria-label="Model"');
    state.comingUp = true;
    const starting = renderSection();
    expect(starting).toContain("Agent is starting…");
    expect(starting).not.toContain("Start agent to edit");
  });

  /** TEST_SCENARIO: A new agent that never ran has reported no harnesses, so
   * there is no pair to show; the section still says the agent must be
   * started rather than disappearing. */
  it("offers to start an agent that never ran", () => {
    state.hasRun = false;
    const html = renderSection();
    expect(html).toContain("Default for new sessions");
    expect(html).toContain("Start agent to edit");
    expect(html).not.toContain('aria-label="Harness"');
  });

  /** TEST_SCENARIO: Once the agent is up, the picker lists its models. */
  it("lists the models once the agent is up", () => {
    state.operable = true;
    const html = renderSection();
    expect(html).toContain('aria-label="Model"');
    expect(html).not.toContain("Start agent to edit");
  });
});
