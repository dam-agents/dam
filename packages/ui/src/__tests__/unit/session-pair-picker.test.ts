// @vitest-environment happy-dom
import type { HarnessCapability } from "agent-runtime-api";
import { act, createElement, Fragment, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
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
          category: "thought_level",
          default: "low",
          choices: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
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
  answerable: undefined as boolean | undefined,
  refetch: vi.fn(),
  providersAsked: [] as string[],
  owned: [] as { id: string; name: string; type: string }[],
  noProviders: false,
  ungranted: false,
  chosen: null as {
    harness: string;
    provider: string | null;
    model: string | null;
    settings?: Record<string, string>;
  } | null,
  configured: undefined as
    { mode: string | null; configOptions: Record<string, string> } | undefined,
  showConfirm: vi.fn(),
  revoke: vi.fn(),
  buttons: {} as Record<string, () => void>,
  newSession: vi.fn(),
  connectProviders: vi.fn(),
  catalogLoaded: true,
  catalog: undefined as
    | {
        harness: string;
        routed: boolean;
        providers: {
          connectionId: string;
          alias: string;
          template: string;
          displayName: string;
          status: "listed" | "unavailable" | "unsupported";
          listedAt: string | null;
          models: {
            name: string;
            upstreamId: string;
            contextWindow: number | null;
            maxOutputTokens: number | null;
            reasoning: boolean | null;
            vision: boolean | null;
            prices: null;
            source: { limits: "none"; prices: "none" };
          }[];
        }[];
      }
    | undefined,
  chosenModel: vi.fn(),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({
      nextSessionPair: state.chosen ? { agent: state.chosen } : {},
      setNextSessionPair: state.chosenModel,
      navigateToSandboxHome: vi.fn(),
      showConfirm: state.showConfirm,
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
  Tooltip: ({ children }: PropsWithChildren) => {
    const child = children as { props?: Record<string, unknown> };
    const props = (
      child.props?.children as { props?: Record<string, unknown> } | undefined
    )?.props;
    if (typeof props?.["aria-label"] === "string")
      state.buttons[props["aria-label"]] = props.onClick as () => void;
    return createElement(Fragment, null, children);
  },
}));

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({ data: { followsDefaults: false } }),
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentAnswerableSoon: () => state.answerable ?? state.operable,
}));

vi.mock("../../modules/agents/hooks/use-operable-state.js", () => ({
  useOperableState: () => ({
    operable: state.operable,
    comingUp: !state.operable && !!state.answerable,
  }),
}));

vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake: vi.fn(), isPending: false }),
}));

vi.mock("../../modules/sessions/hooks/use-provider-usage.js", () => ({
  useProviderUsage: () => () => ({ kinds: [], schedules: [], profiles: [] }),
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

let profilesState: readonly unknown[] = [];
let agentAccess: "owner" | "editor" = "owner";
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => ({
    access: {
      role: agentAccess,
      editors: [],
      permissions: [],
      ...(agentAccess === "editor" ? { ownerEmail: "alice@example.com" } : {}),
    },
  }),
}));

vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({ data: profilesState }),
}));

vi.mock("../../modules/profiles/lib/profile-detail.js", () => ({
  profileDetail: () => "",
  profileProviderName: () => "",
}));

vi.mock("../../modules/profiles/hooks/use-profile-attach.js", () => ({
  useProfileAttach: () => ({ attach: async () => true, manage: () => {} }),
}));

vi.mock("../../modules/profiles/api/mutations.js", () => ({
  useCreateProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({
    data: state.catalogLoaded && {
      harnesses: [
        {
          name: "pi",
          displayName: "Pi",
          providers: ["ibm-litellm", "curve-bender"],
        },
        { name: "codex", displayName: "Codex", providers: ["openai"] },
      ],
    },
  }),
  useRememberedPair: () => ({
    data: { harness: "pi", provider: "ibm", model: null },
  }),
  useProviderConnections: () =>
    state.noProviders
      ? { granted: [], owned: [], loaded: true }
      : {
          loaded: true,
          granted: state.ungranted
            ? []
            : [
                { id: "ibm", name: "IBM", type: "ibm-litellm" },
                {
                  id: "curve",
                  name: "Curve",
                  type: "curve-bender",
                  templateId: "curve-bender",
                },
              ],
          owned: [
            { id: "ibm", name: "IBM", type: "ibm-litellm" },
            {
              id: "curve",
              name: "Curve",
              type: "curve-bender",
              templateId: "curve-bender",
            },
            ...state.owned,
          ],
        },
  useGrantProvider: () => ({
    grant: vi.fn(),
    revoke: state.revoke,
    pending: false,
  }),
  rememberSessionPair: vi.fn(),
  useHarnessConfigured: () => state.configured,
  useHarnessCatalogModels: () => ({
    data: state.catalog,
    isLoading: state.loading,
    isError: false,
    operable: state.operable,
    refetch: state.refetch,
  }),
  useProviderModels: (_agent: string, _harness: string, provider: string) => {
    state.providersAsked.push(provider);
    return {
      data: state.models[provider],
      isLoading: state.loading,
      isFetching: state.loading || state.fetching,
      isError: false,
      operable: state.operable,
      answerable: state.answerable ?? state.operable,
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
      onConnectProviders: state.connectProviders,
    }),
  );
}

describe("the profile view a routed picker opens on", () => {
  beforeEach(() => {
    state.loading = false;
    state.fetching = false;
    state.operable = true;
    state.owned = [];
    state.catalogLoaded = true;
    state.chosen = null;
    state.catalog = routedCatalog;
  });

  /** TEST_SCENARIO: with profiles to pick from, the routed picker opens on them: a primary-model section, a subagent section behind its toggle, each ending in Custom selection; an unavailable profile is disabled with its reason and the one action that would fix it. */
  it("lists the profiles under both headings, and disables the unavailable one", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/gpt-5.5",
    };
    profilesState = [
      {
        id: "p1",
        name: "Fast review",
        harness: "pi",
        providerTemplate: "ibm-litellm",
        model: "ibm/gpt-5.5",
        settings: {},
        seeded: false,
        usage: { agents: 1, channels: 0, schedules: 0 },
        availability: { available: true, reason: null, attachable: false },
      },
      {
        id: "p2",
        name: "Local only",
        harness: "pi",
        providerTemplate: "curve-bender-deployment",
        model: "cb/local",
        settings: {},
        seeded: false,
        usage: { agents: 0, channels: 0, schedules: 0 },
        availability: {
          available: false,
          reason: "CurveBender (shared) is not connected",
          attachable: false,
        },
      },
    ];
    try {
      const html = renderToStaticMarkup(
        createElement(SessionPairPicker, {
          agentId: "agent",
          defaultHarness: "pi",
          carried,
          routed: true,
          onConnectProviders: state.connectProviders,
        }),
      );
      expect(html).toContain("Primary model");
      expect(html).toContain("Subagent model");
      expect(html).toContain("Let the agent pick");
      expect(html).toContain("Fast review");
      expect(html).toContain("Custom selection");
      expect(html).toContain("1 harness");
      expect(html).not.toContain("line-through");
      expect(html).toContain("CurveBender (shared) is not connected");
      expect(html).toContain("Configure providers");
    } finally {
      profilesState = [];
      state.chosen = null;
    }
  });
});

describe("session pair model choices", () => {
  beforeEach(() => {
    state.models = {};
    state.loading = false;
    state.fetching = false;
    state.operable = true;
    state.answerable = undefined;
    state.providersAsked = [];
    state.owned = [];
    state.noProviders = false;
    state.ungranted = false;
    state.configured = undefined;
    state.chosen = null;
    state.catalogLoaded = true;
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
    expect(html).toContain("Configure providers and defaults");
    expect(html).not.toContain("Set as default");
    expect(html).toContain('aria-label="Disconnect IBM"');
    expect(html).toContain('aria-label="Session settings"');
    expect(html).not.toContain("Harness default");
    expect(html).toContain('<option value="low" selected="">Low</option>');
  });

  // TEST_SCENARIO: A harness that none of the person's providers can run stays listed but cannot be picked, and says why.
  it("grays out a harness no configured provider supports", () => {
    const html = renderToStaticMarkup(
      createElement(SessionPairPicker, {
        agentId: "agent",
        defaultHarness: "pi",
        carried: [
          ...carried,
          { name: "codex", harnessConfig: true, sessionModel: true },
        ],
        onConnectProviders: state.connectProviders,
      }),
    );
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>.*?Codex/);
    expect(html).not.toMatch(/<button type="button" disabled=""[^>]*>.*?Pi</);
    expect(html).toContain('aria-label="Why Codex is unavailable"');
  });

  it("asks before disconnecting a provider, and disconnects only on yes", async () => {
    renderPicker();
    state.showConfirm.mockResolvedValueOnce(false);
    state.buttons["Disconnect IBM"]!();
    await Promise.resolve();
    expect(state.showConfirm).toHaveBeenCalledWith(
      expect.anything(),
      "Disconnect IBM from this agent?",
      { kind: "destructive", confirmLabel: "Disconnect" },
    );
    expect(state.revoke).not.toHaveBeenCalled();
    state.showConfirm.mockResolvedValueOnce(true);
    state.buttons["Disconnect IBM"]!();
    await Promise.resolve();
    expect(state.revoke).toHaveBeenCalledWith("ibm");
  });

  // TEST_SCENARIO: With no provider connection at all there is nothing to pick, so the picker warns in its place and opens the provider modal instead of offering an empty menu.
  it("warns in place of the picker when no provider is connected", () => {
    state.noProviders = true;
    const html = renderPicker();
    expect(html).toContain("Connect an LLM provider</span> first.");
    expect(html).not.toContain('data-testid="session-pair-picker"');
  });

  // TEST_SCENARIO: A provider the owner holds but this agent was not granted yet is attached in the picker, not connected again, so the agent that has not reported its harnesses waits on them instead of asking for a provider.
  it("waits for the agent rather than asking for a provider the owner holds", () => {
    state.ungranted = true;
    const html = renderToStaticMarkup(
      createElement(SessionPairPicker, {
        agentId: "agent",
        agentHarness: "pi",
        pending: true,
        onConnectProviders: state.connectProviders,
      }),
    );
    expect(html).toContain("Loading models…");
    expect(html).not.toContain("Connect an LLM provider");
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
    expect(html).toContain("Couldn&#x27;t load this provider&#x27;s models.");
    expect(html).toContain("Retry");
    expect(html).toContain("No models available.");
    expect(html).not.toContain("Static model");
    expect(html).not.toMatch(/default model/i);
  });

  it("shows loading and stopped states without selectable placeholders", () => {
    state.loading = true;
    const loading = renderPicker();
    expect(loading).toContain("Loading models…");
    expect(loading).toContain("animate-spin");
    state.operable = false;
    expect(renderPicker()).toContain(
      "Start the agent to list this provider&#x27;s models.",
    );
  });

  // TEST_SCENARIO: A waking agent lists its models once it answers, so the picker shows them loading rather than asking for a start that is already under way.
  it("shows a waking agent's models as loading", () => {
    state.operable = false;
    state.answerable = true;
    const html = renderPicker();
    expect(html).toContain("Loading models…");
    expect(html).not.toContain("Start the agent");
  });

  // TEST_SCENARIO: Before the agent reports the harnesses it carries, the composer shows the pair a new session would run on, and the popover a loader.
  it("shows the expected pair and a loader before the agent answers", () => {
    const html = renderToStaticMarkup(
      createElement(SessionPairPicker, {
        agentId: "agent",
        agentHarness: "pi",
        pending: true,
        onConnectProviders: state.connectProviders,
      }),
    );
    expect(html).toContain(">IBM</span></button>");
    expect(html).toContain("Loading models…");
    expect(html).not.toContain("Configure");
    expect(html).not.toContain("Connect an LLM provider");
  });

  // TEST_SCENARIO: The harness catalog loads after the agent view, so until it does the label waits on a loader instead of showing the raw harness id.
  it("shows a loader, not the harness id, until the harness catalog loads", () => {
    state.catalogLoaded = false;
    const trigger = (html: string) =>
      /data-testid="session-(pair|model)-picker"[^>]*>(.*?)<\/button>/.exec(
        html,
      )?.[0];
    const triggers = [
      renderToStaticMarkup(
        createElement(SessionPairPicker, {
          agentId: "agent",
          agentHarness: "pi",
          pending: true,
          onConnectProviders: state.connectProviders,
        }),
      ),
      renderPicker(),
      renderToStaticMarkup(
        createElement(ModelIndicator, {
          onToolApproval: () => {},
          agentId: "agent",
          sessionId: "s1",
          harness: "pi",
          provider: "ibm",
          model: null,
          carried,
          onChoose: vi.fn(),
          onConfigure: vi.fn(),
          onNewSession: state.newSession,
        }),
      ),
    ].map(trigger);
    for (const html of triggers) {
      expect(html).toContain('aria-label="Loading harness and model"');
      expect(html).toContain("animate-spin");
      expect(html).not.toMatch(/>pi|Choose/);
    }
  });

  // TEST_SCENARIO: The new session runs on the pair the person picked, so the placeholder label shows that pair over the remembered one.
  it("labels the placeholder with the picked pair", () => {
    state.chosen = { harness: "pi", provider: "curve", model: "glm" };
    const html = renderToStaticMarkup(
      createElement(SessionPairPicker, {
        agentId: "agent",
        agentHarness: "pi",
        pending: true,
        onConnectProviders: state.connectProviders,
      }),
    );
    expect(html).toContain(">glm (Curve)</span></button>");
  });

  it("warns before the agent answers when no provider is connected", () => {
    state.noProviders = true;
    const html = renderToStaticMarkup(
      createElement(SessionPairPicker, {
        agentId: "agent",
        agentHarness: "pi",
        pending: true,
        onConnectProviders: state.connectProviders,
      }),
    );
    expect(html).toContain("Connect an LLM provider</span> first.");
    expect(html).not.toContain("Loading models…");
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
      expected: "Couldn&#x27;t load this provider&#x27;s models.",
    },
  ])(
    "renders the active provider with $expected during background polls",
    ({ availableModels, expected }) => {
      state.models = { curve: { availableModels } };
      state.fetching = true;
      const html = renderToStaticMarkup(
        createElement(ModelIndicator, {
          onToolApproval: () => {},
          agentId: "agent",
          sessionId: "s1",
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
      expect(html).not.toContain("Other harnesses and models need a");
      expect(html).toContain(">Change</button>");
      expect(html).not.toContain("start a new session");
      expect(html).toContain(">Pi</span>");
      if (availableModels !== null) expect(html).not.toContain("Static model");
    },
  );

  // TEST_SCENARIO: The provider no longer lists the session's model, as when it retired the model after the session picked it, so the label says so instead of showing the pick as if it still ran.
  it("marks a session model the provider no longer lists", () => {
    state.models = {
      curve: { availableModels: [{ value: "glm-5-4", name: "GLM 5.4" }] },
    };
    const label = (model: string) =>
      /data-testid="session-model-picker"[^>]*>(.*?)<\/button>/.exec(
        renderToStaticMarkup(
          createElement(ModelIndicator, {
            onToolApproval: () => {},
            agentId: "agent",
            sessionId: "s1",
            harness: "pi",
            provider: "curve",
            model,
            carried,
            onChoose: vi.fn(),
            onConfigure: vi.fn(),
            onNewSession: state.newSession,
          }),
        ),
      )?.[0];
    expect(label("glm-5-3")).toContain("glm-5-3 (Curve) · Model not offered");
    expect(label("glm-5-4")).not.toContain("Model not offered");
  });

  it("uses a harness catalog only when discovery is explicitly not configured", () => {
    state.models = { ibm: { availableModels: null } };
    expect(renderPicker()).toContain("Static model");
  });
});

const model = (alias: string, upstreamId: string, contextWindow = 200_000) => ({
  name: `${alias}/${upstreamId}`,
  upstreamId,
  contextWindow,
  maxOutputTokens: null,
  reasoning: null,
  vision: null,
  prices: null,
  source: { limits: "none" as const, prices: "none" as const },
});

const routedCatalog = {
  harness: "pi",
  routed: true,
  providers: [
    {
      connectionId: "ibm",
      alias: "ibm",
      template: "ibm-litellm",
      displayName: "IBM",
      status: "listed" as const,
      listedAt: null,
      models: [model("ibm", "gpt-5.5")],
    },
    {
      connectionId: "curve",
      alias: "cb",
      template: "curve-bender",
      displayName: "Curve",
      status: "listed" as const,
      listedAt: null,
      models: [model("cb", "rits/zai-org/glm-5-3", 128_000)],
    },
  ],
};

describe("one model list on a runtime that routes by model name", () => {
  beforeEach(() => {
    state.models = {};
    state.loading = false;
    state.operable = true;
    state.owned = [];
    state.noProviders = false;
    state.ungranted = false;
    state.configured = undefined;
    state.chosen = null;
    state.catalog = routedCatalog;
    state.providersAsked = [];
    state.chosenModel.mockReset();
  });

  /** TEST_SCENARIO: Before a session starts, every attached provider's
   * models are one grouped list by family, a model of a known family with
   * no recognised size behind that family's More, a model of no known
   * family under Other, and the per-provider model hooks of the old runtime
   * are never asked. */
  it("lists every provider's models in one grouped list", () => {
    const html = renderToStaticMarkup(
      createElement(SessionPairPicker, {
        agentId: "agent",
        defaultHarness: "pi",
        carried,
        routed: true,
        onConnectProviders: state.connectProviders,
      }),
    );
    expect(html).toContain('aria-label="GPT"');
    expect(html).toContain('aria-label="GLM"');
    expect(html).toContain("2 models");
    expect(html).toContain("5.3");
    expect(html).toContain("More");
    expect(html).not.toContain("Other");
    expect(html).not.toContain('aria-label="IBM"');
    expect(html).not.toContain('aria-label="Curve"');
    expect(html).not.toContain("Disconnect IBM");
    expect(state.providersAsked).toEqual([]);
  });

  /** TEST_SCENARIO: The model list is read from the running agent, so on a
   * sleeping agent the list gives way to the start button rather than an
   * empty list, and to "Agent is starting…" once the start is under way. */
  it("offers to start a sleeping agent instead of an empty model list", () => {
    const render = () =>
      renderToStaticMarkup(
        createElement(SessionPairPicker, {
          agentId: "agent",
          defaultHarness: "pi",
          carried,
          routed: true,
          onConnectProviders: state.connectProviders,
        }),
      );
    state.operable = false;
    const asleep = render();
    expect(asleep).toContain("Start agent to edit");
    expect(asleep).not.toContain("gpt-5.5");
    state.answerable = true;
    const starting = render();
    expect(starting).toContain("Agent is starting…");
    expect(starting).not.toContain("Start agent to edit");
    state.answerable = undefined;
  });

  /** TEST_SCENARIO: Known models are grouped by family and size, one entry
   * per size on the newest version with the providers that offer it, older
   * versions behind More, and models of no known family last under Other. */
  it("groups known models by family and size, with a provider choice", () => {
    state.catalog = {
      harness: "pi",
      routed: true,
      providers: [
        {
          connectionId: "ibm",
          alias: "ibm",
          template: "ibm-litellm",
          displayName: "IBM",
          status: "listed" as const,
          listedAt: null,
          models: [
            model("ibm", "aws/claude-opus-5-5"),
            model("ibm", "aws/claude-opus-5-1"),
            model("ibm", "azure/gpt-5.6-sol"),
            model("ibm", "rits/deepseek-ai/DeepSeek-V3.2"),
          ],
        },
        {
          connectionId: "anthropic",
          alias: "anthropic",
          template: "anthropic",
          displayName: "Anthropic",
          status: "listed" as const,
          listedAt: null,
          models: [model("anthropic", "claude-opus-5-5")],
        },
        {
          connectionId: "curve",
          alias: "cb",
          template: "curve-bender",
          displayName: "Curve",
          status: "listed" as const,
          listedAt: null,
          models: [model("cb", "gpt-5.6-sol")],
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(SessionPairPicker, {
        agentId: "agent",
        defaultHarness: "pi",
        carried,
        routed: true,
        onConnectProviders: state.connectProviders,
      }),
    );
    expect(html).toContain('aria-label="Claude"');
    expect(html).toContain('aria-label="GPT"');
    expect(html).toContain("Opus 5.5");
    expect(html).not.toContain("Opus 5.1");
    expect(html).toContain("More");
    expect(html).toContain('aria-label="Provider for Opus 5.5: IBM"');
    expect(html).toContain('aria-label="Provider for Sol 5.6: IBM"');
    expect(html).toContain('aria-label="DeepSeek"');
    expect(html).not.toContain("rits/deepseek-ai/DeepSeek-V3.2");
    expect(html.indexOf('aria-label="Claude"')).toBeLessThan(
      html.indexOf('aria-label="GPT"'),
    );
    expect(html.indexOf('aria-label="GPT"')).toBeLessThan(
      html.indexOf('aria-label="DeepSeek"'),
    );
  });

  /** TEST_SCENARIO: In a running session the popover lists the same grouped
   * list across providers, with no new-session gate, and says a pick lands
   * on the next message while a turn runs; the label under the composer
   * reads the pretty family name. */
  it("offers every provider's models to a running session", () => {
    const html = renderToStaticMarkup(
      createElement(ModelIndicator, {
        onToolApproval: () => {},
        agentId: "agent",
        sessionId: "s1",
        harness: "pi",
        provider: "ibm",
        model: "ibm/gpt-5.5",
        carried,
        routed: true,
        turnRunning: true,
        onChoose: vi.fn(),
        onConfigure: vi.fn(),
        onNewSession: state.newSession,
      }),
    );
    expect(html).toContain("GPT 5.5");
    expect(html).toContain('aria-label="GLM"');
    expect(html).toContain("applies to the next message");
    expect(html).not.toContain("start a new session");
    expect(html).not.toContain(">Change<");
  });

  /** TEST_SCENARIO: The label under the composer is the model family's pretty name for a matched model, not its provider. */
  it("shows the pretty model name under the composer", () => {
    const html = renderToStaticMarkup(
      createElement(ModelIndicator, {
        onToolApproval: () => {},
        agentId: "agent",
        sessionId: "s1",
        harness: "pi",
        provider: "curve",
        model: "cb/rits/zai-org/glm-5-3",
        carried,
        routed: true,
        onChoose: vi.fn(),
        onConfigure: vi.fn(),
        onNewSession: state.newSession,
      }),
    );
    const trigger =
      /data-testid="session-model-picker"[^>]*>(.*?)<\/button>/.exec(html)?.[1];
    expect(trigger).toContain("GLM 5.3");
    expect(trigger).not.toContain("Curve");
  });

  /** TEST_SCENARIO: The provider a running session's model names (the
   * runtime keeps no Connection id on a routed session) was removed from the
   * agent. The session says so and offers the other providers' models and,
   * since the owner still holds the Connection, re-attaching it. */
  it("offers re-attach or another provider's model when the provider was removed", () => {
    state.catalog = {
      ...routedCatalog,
      providers: [routedCatalog.providers[1]!],
    };
    state.owned = [
      {
        id: "anthropic-gone",
        name: "Anthropic old",
        type: "anthropic",
        templateId: "anthropic",
      } as never,
    ];
    const html = renderToStaticMarkup(
      createElement(ModelIndicator, {
        onToolApproval: () => {},
        agentId: "agent",
        sessionId: "s1",
        harness: "pi",
        provider: null,
        model: "anthropic/claude-sonnet-5-5",
        carried,
        routed: true,
        onChoose: vi.fn(),
        onConfigure: vi.fn(),
        onNewSession: state.newSession,
      }),
    );
    expect(html).toContain("Provider removed");
    expect(html).toContain("Attach Anthropic old again");
    expect(html).toContain('aria-label="GLM"');
  });
});

describe("JanUI's picker and the default's editor", () => {
  beforeEach(() => {
    state.models = {};
    state.loading = false;
    state.operable = true;
    state.owned = [{ id: "other", name: "Other", type: "curve-bender" }];
    state.noProviders = false;
    state.ungranted = false;
    state.configured = undefined;
    state.chosen = null;
    state.catalog = routedCatalog;
    state.providersAsked = [];
  });

  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(SessionPairPicker, {
        agentId: "agent",
        defaultHarness: "pi",
        carried,
        routed: true,
        onConnectProviders: state.connectProviders,
        ...props,
      }),
    );

  /** TEST_SCENARIO: The routed model list ends with one Connect more
   * providers row that leads to the Providers page; the separate attach
   * rows, the manage-providers row and the disconnect controls are gone,
   * in both layouts. */
  it("offers one Connect more providers row", () => {
    for (const props of [{ newLayout: true }, {}]) {
      const html = render(props);
      expect(html).toContain("Connect more providers");
      expect(html).not.toContain("Disconnect IBM");
      expect(html).not.toContain("Attach this provider");
      expect(html).not.toContain("Manage providers");
      expect(html).not.toContain("Configure providers and defaults");
    }
  });
});

describe("the profile save on a shared agent", () => {
  /** TEST_SCENARIO: An Agent Editor may use the owner's profiles and may not
   * change that set, so the picker offers no save there. */
  it("offers the save on an agent the person owns, and not on a shared one", () => {
    profilesState = [];
    state.loading = false;
    state.chosen = {
      harness: "pi",
      provider: "curve",
      model: "cb/rits/zai-org/glm-5-3",
    };
    state.catalogLoaded = true;
    const render = () =>
      renderToStaticMarkup(
        createElement(SessionPairPicker, {
          agentId: "agent",
          defaultHarness: "pi",
          carried,
          routed: true,
          onConnectProviders: state.connectProviders,
        }),
      );
    const own = render();
    expect(own).toContain("Save as a profile");
    agentAccess = "editor";
    try {
      expect(render()).not.toContain("Save as a profile");
    } finally {
      agentAccess = "owner";
      state.chosen = null;
    }
  });
});

describe("the profile a session's pick came from", () => {
  /** TEST_SCENARIO: A profile picked in one session makes its Save row
   * Update that profile; after a switch to another session, the row saves a
   * new profile instead of overwriting the first session's. */
  it("does not carry the picked profile into another session", () => {
    profilesState = [
      {
        id: "p1",
        name: "Fast review",
        harness: "pi",
        providerTemplate: "curve-bender",
        model: "cb/rits/zai-org/glm-5-3",
        settings: {},
        seeded: false,
        usage: { agents: 1, channels: 0, schedules: 0 },
        availability: { available: true, reason: null, attachable: false },
      },
    ];
    state.catalog = routedCatalog;
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = (sessionId: string) =>
      act(() =>
        root.render(
          createElement(ModelIndicator, {
            onToolApproval: () => {},
            agentId: "agent",
            sessionId,
            harness: "pi",
            provider: "curve",
            model: "cb/rits/zai-org/glm-5-3",
            carried,
            routed: true,
            onChoose: vi.fn(),
            onConfigure: vi.fn(),
            onNewSession: state.newSession,
          }),
        ),
      );
    const click = (text: string) => {
      const button = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(text),
      );
      act(() => button?.click());
    };
    try {
      render("s1");
      click("Fast review");
      click("Custom selection");
      expect(container.textContent).toContain("Update “Fast review”");
      render("s2");
      expect(container.textContent).toContain("Save as a profile");
      expect(container.textContent).not.toContain("Update “Fast review”");
    } finally {
      act(() => root.unmount());
      profilesState = [];
    }
  });
});
