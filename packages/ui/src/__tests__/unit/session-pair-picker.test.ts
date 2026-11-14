// @vitest-environment happy-dom
// TEST_OVERVIEW: The harness and model panel is provider first: Provider, Harness, Model and Effort are dropdowns, Subagents and the profile save sit behind More options, "Use a profile" opens the saved profiles, and the same body serves a new session, an open session, a config page's default and a profile in Settings. A pick always leaves the panel as a whole pair.
import type * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { HarnessCapability } from "agent-runtime-api";
import { lentSubagentOfProfile, modelConstraintsFor } from "agent-runtime-api";
import type { ProfileWithUsage, SessionPair } from "api-server-api";
import {
  act,
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelIndicator } from "../../modules/sessions/components/model-indicator.js";
import { ValueMenu } from "../../modules/sessions/components/session-model-picker.js";
import { SessionPairPicker } from "../../modules/sessions/components/session-pair-picker.js";
import { modelGroups } from "../../modules/sessions/lib/catalog-groups.js";

const carried: HarnessCapability[] = [
  {
    name: "pi",
    harnessConfig: true,
    sessionModel: true,
    sessionSettings: ["mode"],
    harnessConfigCatalog: {
      modelConstraints: { "gpt-5.5": { mode: [] } },
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
        {
          id: "cacheTtl",
          name: "Prompt cache",
          category: "cache",
          default: "5m",
          choices: [
            { value: "5m", name: "5 minutes" },
            { value: "1h", name: "1 hour" },
          ],
        },
      ],
    },
  },
];

const modelView = (
  alias: string,
  upstreamId: string,
  contextWindow = 200_000,
) => ({
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
      models: [
        modelView("ibm", "aws/claude-opus-5-5"),
        modelView("ibm", "aws/claude-opus-5-1"),
        modelView("ibm", "azure/gpt-5.5"),
        modelView("ibm", "aws/claude-haiku-5-5"),
        modelView("ibm", "rits/moonshotai/Kimi-K2.5"),
      ],
    },
    {
      connectionId: "curve",
      alias: "cb",
      template: "curve-bender",
      displayName: "Curve",
      status: "listed" as const,
      listedAt: null,
      models: [modelView("cb", "rits/zai-org/glm-5-3", 128_000)],
    },
  ],
};

const claudeCode: HarnessCapability = {
  name: "claude-code",
  harnessConfig: true,
  sessionModel: true,
  sessionSettings: ["effort", "subagentModel", "subagentEffort"],
  harnessConfigCatalog: {
    modelConstraints: {
      haiku: { effort: [], subagentEffort: [] },
      "claude-haiku-4-5": { effort: [], subagentEffort: [] },
    },
    options: [
      {
        id: "model",
        name: "Model",
        category: "model",
        choices: [],
      },
      {
        id: "subagentModel",
        name: "Subagent model",
        category: "model",
        subagents: true,
        choices: [],
      },
      {
        id: "effort",
        name: "Effort",
        category: "thought_level",
        default: "medium",
        choices: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      },
      {
        id: "subagentEffort",
        name: "Subagent effort",
        category: "thought_level",
        subagents: true,
        choices: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      },
    ],
  },
};

const claudeCatalog = {
  harness: "claude-code",
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
        modelView("ibm", "aws/claude-opus-5-5"),
        modelView("ibm", "aws/claude-haiku-5-5"),
        modelView("ibm", "azure/gpt-5.5"),
      ],
    },
  ],
};

const state = vi.hoisted(() => ({
  models: {} as Record<
    string,
    { availableModels?: { value: string; name: string }[] | null }
  >,
  loading: false,
  operable: true,
  answerable: undefined as boolean | undefined,
  refetch: vi.fn(),
  providersAsked: [] as string[],
  owned: [] as { id: string; name: string; type: string }[],
  granted: [] as { id: string; name: string; type: string }[],
  oneProvider: false,
  noProviders: false,
  ungranted: false,
  chosen: null as SessionPair | null,
  configured: undefined as
    { mode: string | null; configOptions: Record<string, string> } | undefined,
  showConfirm: vi.fn(),
  revoke: vi.fn(),
  newSession: vi.fn(),
  connectProviders: vi.fn(),
  catalogLoaded: true,
  catalog: undefined as typeof routedCatalog | undefined,
  catalogError: false,
  profileMutate: vi.fn(),
  chosenModel: vi.fn(),
  grant: vi.fn(async (_id: string) => true),
  navigate: vi.fn(),
  navigateSettings: vi.fn(),
  remember: vi.fn(),
  saved: undefined as
    | {
        chatProfileId?: string | null;
        platformSubagentProfileId?: string | null;
        platformSubagentSettings?: Record<string, string> | null;
      }
    | undefined,
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({
      nextSessionPair: state.chosen ? { agent: state.chosen } : {},
      setNextSessionPair: state.chosenModel,
      navigateToSandboxHome: state.navigate,
      navigateToSettings: state.navigateSettings,
      showConfirm: state.showConfirm,
    }),
}));

vi.mock("@radix-ui/react-dropdown-menu", async (importOriginal) => {
  const actual = await importOriginal<typeof DropdownPrimitive>();
  return {
    ...actual,
    Root: (props: PropsWithChildren) =>
      createElement(actual.Root, { ...props, defaultOpen: true }),
    Portal: ({ children }: PropsWithChildren) =>
      createElement(Fragment, null, children),
    Content: (props: Record<string, unknown>) =>
      createElement(actual.Content, {
        ...props,
        onOpenAutoFocus: (event: Event) => event.preventDefault(),
      } as never),
  };
});

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
  Tooltip: ({
    children,
    content,
  }: PropsWithChildren<{ content: ReactNode }>) =>
    isValidElement(children)
      ? cloneElement(
          children as ReactElement<{ "data-tooltip"?: string }>,
          typeof content === "string" ? { "data-tooltip": content } : {},
        )
      : createElement(Fragment, null, children),
}));

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({ data: { followsDefaults: false } }),
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => ({
    access: { role: "owner", editors: [], permissions: [] },
  }),
}));

vi.mock("../../modules/sessions/hooks/use-provider-usage.js", () => ({
  useProviderUsage: () => () => ({
    kinds: [],
    schedules: [],
    turnedOffSchedules: 0,
    pages: [],
    profiles: [],
  }),
}));

let profilesState: ProfileWithUsage[] = [];
vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({ data: profilesState }),
}));

vi.mock(
  "../../modules/profiles/lib/profile-detail.js",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    profileSummary: () => "",
    profileProviderName: () => "",
  }),
);

vi.mock("../../modules/profiles/hooks/use-profile-attach.js", () => ({
  useProfileAttach: () => ({
    attach: async () => "conn-oai",
    manage: () => {},
  }),
}));

vi.mock("../../modules/profiles/api/mutations.js", () => ({
  useCreateProfile: () => ({ mutate: state.profileMutate, isPending: false }),
  useUpdateProfile: () => ({ mutate: state.profileMutate, isPending: false }),
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({
    data: state.catalogLoaded && {
      harnesses: [
        {
          name: "pi",
          displayName: "Pi",
          providers: ["ibm-litellm", "curve-bender", "anthropic"],
        },
        {
          name: "claude-code",
          displayName: "Claude Code",
          description: "Anthropic's coding agent",
          providers: ["ibm-litellm", "curve-bender", "anthropic", "bedrock"],
        },
        {
          name: "codex",
          displayName: "Codex",
          providers: ["ibm-litellm", "curve-bender", "openai"],
        },
        {
          name: "hermes",
          displayName: "Hermes",
          providers: ["ibm-litellm", "curve-bender", "openai"],
        },
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
            : state.oneProvider
              ? [{ id: "curve", name: "Curve", type: "curve-bender" }]
              : [
                  {
                    id: "ibm",
                    name: "IBM",
                    type: "ibm-litellm",
                    templateId: "ibm-litellm",
                  },
                  {
                    id: "curve",
                    name: "Curve",
                    type: "curve-bender",
                    templateId: "curve-bender",
                  },
                  ...state.granted,
                ],
          owned: state.oneProvider
            ? [{ id: "curve", name: "Curve", type: "curve-bender" }]
            : [
                {
                  id: "ibm",
                  name: "IBM",
                  type: "ibm-litellm",
                  templateId: "ibm-litellm",
                },
                {
                  id: "curve",
                  name: "Curve",
                  type: "curve-bender",
                  templateId: "curve-bender",
                },
                ...state.granted,
                ...state.owned,
              ],
        },
  useGrantProvider: () => ({
    grant: state.grant,
    revoke: state.revoke,
    pending: false,
  }),
  rememberSessionPair: state.remember,
  useHarnessConfigured: () => state.configured,
  useSessionDefaults: () => ({ data: state.saved }),
  useHarnessCatalogModels: (agentId: string | null) => ({
    forHarness: () =>
      state.catalog
        ? modelGroups(
            state.catalog as never,
            agentId === null
              ? null
              : ["ibm", "curve", ...state.granted.map((g) => g.id)],
          )
        : undefined,
    granted:
      agentId === null
        ? null
        : ["ibm", "curve", ...state.granted.map((g) => g.id)],
    data: state.catalog,
    modelCount: (name: string) =>
      state.catalog?.harness === name
        ? state.catalog.providers.reduce((n, p) => n + p.models.length, 0)
        : 0,
    isLoading: state.loading,
    isError: state.catalogError,
    operable: state.operable,
    refetch: state.refetch,
  }),
  useProviderModels: (_agent: string, _harness: string, provider: string) => {
    state.providersAsked.push(provider);
    return {
      data: state.models[provider],
      isLoading: state.loading,
      isFetching: state.loading,
      isError: false,
      operable: state.operable,
      answerable: state.answerable ?? state.operable,
      refetch: state.refetch,
    };
  },
}));

state.catalog = routedCatalog;

const profile = (
  overrides: Partial<ProfileWithUsage> = {},
): ProfileWithUsage => ({
  id: "p1",
  name: "Fast review",
  harness: "pi",
  providerTemplate: "curve-bender",
  model: "cb/rits/zai-org/glm-5-3",
  settings: {},
  subagent: null,
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: false },
  ...overrides,
});

const picker = (props: Record<string, unknown> = {}) =>
  createElement(SessionPairPicker, {
    agentId: "agent",
    defaultHarness: "pi",
    carried,
    routed: true,
    onConnectProviders: state.connectProviders,
    ...props,
  });

let root: Root | null = null;
let container: HTMLDivElement;

function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  profilesState = [];
  state.granted = [];
  state.owned = [];
  state.oneProvider = false;
  state.noProviders = false;
  state.ungranted = false;
  state.chosen = null;
  state.catalog = routedCatalog;
  state.catalogLoaded = true;
  state.catalogError = false;
  state.loading = false;
  state.operable = true;
  state.answerable = undefined;
  state.configured = undefined;
  state.models = {};
  state.saved = undefined;
  vi.clearAllMocks();
});

beforeEach(() => {
  state.chosenModel.mockReset();
  state.remember.mockReset();
  state.navigate.mockReset();
  state.navigateSettings.mockReset();
  state.grant.mockClear();
});

const openMore = (node: ParentNode) => {
  const button = [...node.querySelectorAll<HTMLElement>("button")].find((b) =>
    b.textContent?.includes("More options"),
  );
  if (button?.getAttribute("aria-expanded") === "false")
    act(() => button.click());
};
const click = (node: ParentNode, text: string) => {
  const button = [...node.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  expect(button, `a button reading ${text}`).toBeDefined();
  act(() => button!.click());
};
const lastCall = <T extends unknown[]>(mock: { mock: { calls: T[] } }) =>
  mock.mock.calls[mock.mock.calls.length - 1]!;
const menu = (node: ParentNode, label: string) =>
  node.querySelector(`[role="menu"][aria-label="${label}"]`);
const labelOf = (node: ParentNode, button: Element) => {
  const [first] = (button.getAttribute("aria-labelledby") ?? "").split(" ");
  return node.querySelector(`#${first}`)?.textContent ?? "";
};
const openMenu = (node: ParentNode, label: string) => {
  if (menu(node, label)) return menu(node, label)!;
  const trigger = [
    ...node.querySelectorAll<HTMLElement>("button[aria-labelledby]"),
  ].find((button) => labelOf(node, button) === label);
  expect(trigger, `the ${label} trigger`).toBeDefined();
  act(() => {
    trigger!.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    trigger!.click();
  });
  return menu(node, label)!;
};
const menuItems = (node: ParentNode, label: string) => [
  ...openMenu(node, label).querySelectorAll<HTMLElement>(
    '[role="menuitemradio"]',
  ),
];
const pickMenu = (node: ParentNode, label: string, text: string) => {
  const item = menuItems(node, label).find((row) =>
    row.textContent?.includes(text),
  );
  expect(item, `${label} → ${text}`).toBeDefined();
  act(() => item!.click());
};
const pickEffort = (node: ParentNode, text: string) =>
  pickMenu(node, menu(node, "Thinking") ? "Thinking" : "Effort", text);
const menuTrigger = (node: ParentNode, suffix: string) =>
  node
    .querySelector(`button[aria-labelledby*="-${suffix}-label"]`)
    ?.textContent?.trim();
const menuItem = (node: ParentNode, text: string) => {
  const item = [
    ...node.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'),
  ].find((b) => b.textContent?.includes(text));
  expect(item, `a menu item reading ${text}`).toBeDefined();
  return item as HTMLElement;
};
const clickMenu = (node: ParentNode, text: string) => {
  const item = menuItem(node, text);
  act(() => item.click());
};
const profileRow = (node: ParentNode, name: string) => {
  const row = [...node.querySelectorAll<HTMLButtonElement>("li button")].find(
    (b) => b.textContent?.includes(name),
  );
  expect(row, `a profile row reading ${name}`).toBeDefined();
  act(() => row!.click());
};

describe("the new session panel", () => {
  /** TEST_SCENARIO: the panel is provider first, every row a labelled dropdown, and profiles are a secondary entry at the bottom rather than the screen it opens on. */
  it("opens on the custom view with labelled dropdowns, not a profile list", () => {
    const html = renderToStaticMarkup(picker());
    expect(html.indexOf(">Harness<")).toBeLessThan(html.indexOf(">Model<"));
    expect(html.indexOf(">Model<")).toBeLessThan(html.indexOf(">Provider<"));
    expect(html.indexOf(">Provider<")).toBeLessThan(html.indexOf(">Thinking<"));
    expect(html.indexOf(">Thinking<")).toBeLessThan(
      html.indexOf("More options"),
    );
    expect(html).not.toContain("Custom selection");
    expect(html).not.toContain("Primary model");
    expect(html).not.toContain("Use a profile");
    for (const [, id] of html.matchAll(/<label for="([^"]+)"/g))
      expect(html).toContain(`id="${id}"`);
  });

  /** TEST_SCENARIO: the model list holds each model once across the owner's providers and the harness's whole catalog, and the provider row disables a provider that does not offer the picked model for the harness, saying so. */
  it("lists each model once and disables a provider that lacks it", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(picker());
    const modelText = openMenu(node, "Model").textContent ?? "";
    expect(modelText).toContain("Claude");
    expect(modelText).toContain("GLM");
    expect(modelText).toContain("Other");
    expect(modelText.match(/Claude Opus 5\.5/g)).toHaveLength(1);
    expect(menuItem(node, "IBM").getAttribute("aria-disabled")).toBeNull();
    const curve = menuItem(node, "Curve");
    expect(curve.getAttribute("aria-disabled")).toBe("true");
    expect(curve.getAttribute("data-tooltip")).toContain(
      "Doesn't offer Claude Opus 5.5 for Pi",
    );
    expect(curve.textContent).not.toMatch(/\d+ models?/);
    expect(menuItem(node, "Manage providers")).toBeDefined();
  });

  /** TEST_SCENARIO: a provider row keeps its element and the keyboard focus when a new pick gives it a reason, so the open menu does not lose its place. */
  it("keeps a focused provider row when its reason appears", () => {
    state.chosen = {
      harness: "pi",
      provider: "curve",
      model: "cb/rits/zai-org/glm-5-3",
    };
    const node = mount(picker());
    const curve = menuItem(node, "Curve");
    expect(curve.getAttribute("data-tooltip")).toBeNull();
    act(() => curve.focus());
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    act(() => root!.render(picker()));
    expect(menuItem(node, "Curve")).toBe(curve);
    expect(curve.getAttribute("data-tooltip")).toContain("Doesn't offer");
    expect(document.activeElement).toBe(curve);
  });

  /** TEST_SCENARIO: the panel opens on the fields while the profile in use is the only profile there is (QA: every new agent runs on the one profile "Default", so the chip and "Use a different provider" opened a list with one entry, and the provider choice was one hop further). */
  it("opens on the fields while one profile is the only one", () => {
    state.chosen = {
      harness: "pi",
      provider: "curve",
      model: "cb/rits/zai-org/glm-5-3",
    };
    profilesState = [profile()];
    const node = mount(picker());
    expect(node.textContent).not.toContain("Saved profiles");
    expect(node.textContent).toContain("Using profile");
    expect(menuTrigger(node, "harness")).toBeDefined();
  });

  /** TEST_SCENARIO: once there are two profiles to choose between, the panel opens on their list, which is what a picker following a profile is for then. */
  it("opens on the saved profiles once there are two", () => {
    state.chosen = {
      harness: "pi",
      provider: "curve",
      model: "cb/rits/zai-org/glm-5-3",
    };
    profilesState = [profile(), profile({ id: "p2", name: "Second" })];
    const node = mount(picker());
    expect(node.textContent).toContain("Saved profiles");
  });

  /** TEST_SCENARIO: a greyed provider cannot be picked at all: clicking it or pressing Enter or Space on it changes no chat default and saves nothing; an enabled provider is applied exactly once. */
  it("picks a provider once, and never a greyed one", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    state.chosenModel.mockReset();
    state.remember.mockReset();
    const node = mount(picker());
    act(() => menuItem(node, "Curve").click());
    for (const key of ["Enter", " "])
      act(() => {
        menuItem(node, "Curve").dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
    expect(state.chosenModel).not.toHaveBeenCalled();
    expect(state.remember).not.toHaveBeenCalled();

    act(() => menuItem(node, "IBM").click());
    expect(state.chosenModel).toHaveBeenCalledTimes(1);
    expect(state.remember).toHaveBeenCalledTimes(1);
  });

  /** TEST_SCENARIO: each field's trigger announces its label and its value; a disabled provider is greyed and carries its reason only as the row's tooltip, never as text in the row, and no enabled provider carries an empty tooltip or reason. */
  it("announces the value and the disabled reason", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(
      picker({
        carried: [...carried, { ...carried[0]!, name: "codex" }],
      }),
    );
    const harness = node.querySelector(
      'button[aria-labelledby*="-harness-label"]',
    )!;
    const labelIds = harness.getAttribute("aria-labelledby")!.split(" ");
    expect(labelIds).toHaveLength(2);
    expect(
      labelIds.map((id) => node.querySelector(`#${id}`)?.textContent).join(" "),
    ).toContain("Harness");
    expect(harness.textContent).toContain("Pi");

    const curve = menuItem(node, "Curve");
    expect(curve.getAttribute("aria-disabled")).toBe("true");
    expect(curve.getAttribute("data-tooltip")).toContain("Doesn't offer");
    expect(curve.classList).toContain("opacity-50");
    expect(curve.classList).toContain("cursor-default");
    expect(curve.classList).toContain("data-[highlighted]:bg-transparent");
    expect(curve.classList).not.toContain("data-[highlighted]:bg-muted");
    expect(curve.textContent).not.toContain("Doesn't offer");
    const ibm = menuItem(node, "IBM");
    expect(ibm.getAttribute("data-tooltip")).toBeNull();
    expect(ibm.classList).not.toContain("opacity-50");
    expect(ibm.classList).toContain("data-[highlighted]:bg-muted");
  });

  /** TEST_SCENARIO: picking a model from another provider takes that provider too, and a model every provider offers stays on the one already picked. */
  it("takes the provider a picked model comes from", () => {
    const node = mount(picker());
    pickMenu(node, "Model", "Claude Opus 5.5");
    expect(state.chosenModel).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        provider: "ibm",
        model: "ibm/aws/claude-opus-5-5",
      }),
    );
    pickMenu(node, "Model", "GLM 5.3");
    expect(state.chosenModel).toHaveBeenLastCalledWith(
      "agent",
      expect.objectContaining({
        provider: "curve",
        model: "cb/rits/zai-org/glm-5-3",
      }),
    );
  });

  /** TEST_SCENARIO: the Harness menu says what each harness is, so a person picking between six names has a sentence to go on (QA: "Harness" was the first field of every picker with no hint what any of the names means). */
  it("describes each harness in the harness menu", () => {
    const node = mount(picker({ carried: [...carried, claudeCode] }));
    expect(openMenu(node, "Harness").textContent).toContain(
      "Anthropic's coding agent",
    );
  });

  /** TEST_SCENARIO: the Harness dropdown carries each harness's icon on its option and on the selected value, and its accessible name stays "Harness". */
  it("shows the harness icon on the trigger and each option", () => {
    const node = mount(
      picker({
        carried: [...carried, { ...carried[0]!, name: "codex" }],
      }),
    );
    const trigger = node.querySelector(
      'button[aria-labelledby*="-harness-label"]',
    );
    expect(trigger).not.toBeNull();
    const labelId = trigger!.getAttribute("aria-labelledby")!.split(" ")[0]!;
    expect(node.querySelector(`#${labelId}`)?.textContent).toBe("Harness");
    expect(
      trigger!.querySelector('[role="img"][aria-label="Pi"]'),
    ).not.toBeNull();
    for (const label of ["Pi", "Codex"]) {
      const item = [...node.querySelectorAll('[role="menuitemradio"]')].find(
        (row) => row.textContent?.includes(label),
      );
      expect(
        item?.querySelector(`[role="img"][aria-label="${label}"]`),
      ).not.toBeNull();
    }
  });

  /** TEST_SCENARIO: one provider reads as its name with a Change link to the Providers page, and the dropdown's Manage providers entry is a link, not a pick. */
  it("shows one provider as text with a Change link", () => {
    state.oneProvider = true;
    const node = mount(picker());
    expect(node.textContent).toContain("Curve");
    expect(node.querySelector('button[aria-label^="Provider:"]')).toBeNull();
    click(node, "Change");
    expect(state.navigate).toHaveBeenCalledWith("agent", "providers");
  });

  it("keeps Manage providers out of the pick", () => {
    const node = mount(picker());
    clickMenu(node, "Manage providers");
    expect(state.navigate).toHaveBeenCalledWith("agent", "providers");
    expect(state.chosenModel).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: the model dropdown groups one provider's models by family and keeps older versions behind a toggle, so no model is listed twice for two providers. */
  it("groups the models by family and shows older versions on request", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(picker());
    const items = menuItems(node, "Model").map((row) =>
      row.textContent?.trim(),
    );
    expect(items).toContain("Claude Opus 5.5");
    expect(items).not.toContain("Claude Opus 5.1");
    expect(menu(node, "Model")?.textContent).toContain("Show older versions");
    clickMenu(node, "Show older versions");
    expect(
      menuItems(node, "Model").map((row) => row.textContent?.trim()),
    ).toContain("Claude Opus 5.1");
  });

  /** TEST_SCENARIO: the older-versions toggle acts in place: the menu stays open, focus stays on it, and it selects nothing, whether clicked or pressed with Enter. */
  it("toggles older versions without closing the menu or picking", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    state.chosenModel.mockReset();
    const node = mount(picker());
    const toggle = () => menuItem(node, "Show older versions");
    act(() => toggle().click());
    expect(menu(node, "Model")).not.toBeNull();
    expect(menuItem(node, "Hide older versions")).toBeDefined();
    expect(state.chosenModel).not.toHaveBeenCalled();

    const back = menuItem(node, "Hide older versions");
    act(() => back.focus());
    act(() =>
      back.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(menu(node, "Model")).not.toBeNull();
    expect(menuItem(node, "Show older versions")).toBeDefined();
    expect(state.chosenModel).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a pick on a version behind the older-versions toggle still reads as the selected model while the older versions are collapsed, so the row never blanks a running session. */
  it("shows an older picked model while older versions stay collapsed", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-1",
    };
    const node = mount(picker());
    expect(menuTrigger(node, "model")).toBe("Claude Opus 5.1");
  });

  /** TEST_SCENARIO: Effort (Thinking on a harness that names it so) sits in the main panel with More options closed, and a model constrained by its exact name says so instead of offering a value the harness would refuse. */
  it("puts the effort row in the main panel and greys it out for a model without one", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(picker());
    expect(
      node
        .querySelector('[aria-controls$="-more"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(node.textContent).toContain("Thinking");
    expect(
      menuItems(node, "Thinking").map((row) => row.textContent?.trim()),
    ).toEqual(["Low", "High"]);
    pickMenu(node, "Thinking", "High");
    expect(state.chosenModel).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        settings: expect.objectContaining({ mode: "high" }),
      }),
    );

    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
    };
    act(() => root!.unmount());
    root = null;
    container.remove();
    const greyed = mount(picker());
    expect(greyed.textContent).toContain("GPT 5.5 has no thinking levels");
    expect(
      greyed.querySelector('button[aria-labelledby*="-effort-label"]'),
    ).toBeNull();
  });

  /** TEST_SCENARIO: the gateway's six-model listing yields six distinct entries, only the same name on two providers merging: nothing is dropped or collapsed, and GPT's mini is named as a variant. */
  it("lists every distinct model of a multi-provider listing once", () => {
    const names = [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "gpt-5-5",
      "gpt-5-5-mini",
      "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    ];
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
          models: names.map((name) => modelView("ibm", name)),
        },
        {
          connectionId: "curve",
          alias: "cb",
          template: "curve-bender",
          displayName: "Curve",
          status: "listed" as const,
          listedAt: null,
          models: names.map((name) => modelView("cb", name)),
        },
      ],
    };
    const node = mount(picker());
    clickMenu(node, "Show older versions");
    expect(
      menuItems(node, "Model").map((row) => row.textContent?.trim()),
    ).toEqual([
      "Claude Opus 5.5",
      "Claude Sonnet 5.5",
      "Claude Haiku 5.5",
      "GPT 5.5",
      "GPT 5.5 mini",
      "DeepSeek Flash 4.1",
    ]);
  });

  /** TEST_SCENARIO: More options starts collapsed and opens by itself while the pair already holds a subagent, so a carried choice is visible without a click; Subagents picks a provider and a model, and "Same as agent" is the empty slot. */
  it("collapses More options until a subagent is set, then picks its model", () => {
    const collapsed = renderToStaticMarkup(picker());
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).not.toContain("Subagents");

    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
      settings: {
        "platformSubagent.harness": "pi",
        "platformSubagent.model": "ibm/aws/claude-opus-5-5",
      },
    };
    const node = mount(picker());
    expect(node.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(node.textContent).toContain("Subagents");
    expect(menuTrigger(node, "subagent-model")).toContain("Claude Opus 5.5");
    pickMenu(node, "Subagent model", "Claude Haiku 5.5");
    expect(state.chosenModel).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        settings: expect.objectContaining({
          "platformSubagent.model": "ibm/aws/claude-haiku-5-5",
        }),
      }),
    );
  });

  /** TEST_SCENARIO: Save as a profile sits in the More options header. */
  it("offers Save as a profile in the More options header", () => {
    const collapsed = renderToStaticMarkup(picker());
    expect(collapsed).not.toContain("Save as profile");

    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
    };
    const node = mount(picker());
    openMore(node);
    expect(node.textContent).toContain("Save as profile");
  });

  /** TEST_SCENARIO: a pick that came from a profile offers to update it, not only to save a new one. */
  it("offers to update the profile a pick came from", () => {
    profilesState = [profile()];
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
    };
    const node = mount(picker());
    click(node, "Use a profile");
    profileRow(node, "Fast review");
    click(node, "Back to custom");
    openMore(node);
    expect(node.textContent).toContain("Save as a new profile");
  });

  /** TEST_SCENARIO: a harness picked without a model clears it, and the pair waits for a model there instead of saving a chat default the server would refuse. */
  it("keeps a model when the harness changes", () => {
    const node = mount(
      picker({
        carried: [...carried, { ...carried[0]!, name: "codex" }],
      }),
    );
    expect(
      menuItems(node, "Harness").map((item) => item.textContent?.trim()),
    ).toEqual(["Codex", "Pi"]);
    pickMenu(node, "Harness", "Codex");
    expect(state.chosenModel).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        harness: "codex",
        model: "ibm/aws/claude-opus-5-5",
      }),
    );
  });

  /** TEST_SCENARIO: no provider at all warns in place of the panel, and an agent that has not reported its harnesses yet shows a loader. */
  it("warns in place of the picker when no provider is connected", () => {
    state.noProviders = true;
    const html = renderToStaticMarkup(picker());
    expect(html).toContain("Connect an LLM provider</span> first.");
    expect(html).not.toContain('data-testid="session-pair-picker"');
  });

  it("shows the expected pair and a loader before the agent answers", () => {
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

  it("shows a loader, not the harness id, until the harness catalog loads", () => {
    state.catalogLoaded = false;
    const html = renderToStaticMarkup(
      createElement(ModelIndicator, {
        onToolApproval: () => {},
        agentId: "agent",
        sessionId: "s1",
        harness: "pi",
        provider: "ibm",
        model: null,
        carried,
        routed: true,
        onChoose: vi.fn(),
        onConfigure: vi.fn(),
        onNewSession: state.newSession,
      }),
    );
    expect(html).toContain('aria-label="Loading harness and model"');
  });
});

describe("the saved profiles behind Use a profile", () => {
  /** TEST_SCENARIO: Use a profile opens the saved profiles, a row per profile with its model, and the selected row expands to its provider, harness, model, effort and subagents, with Edit profile and Manage. */
  it("opens the profiles view, the selected row expanded", () => {
    profilesState = [
      profile({
        id: "p1",
        name: "Deep review",
        model: "ibm/aws/claude-opus-5-5",
        providerTemplate: "ibm-litellm",
        settings: { mode: "high" },
        subagent: {
          providerTemplate: "curve-bender",
          model: "cb/rits/zai-org/glm-5-3",
        },
      }),
      profile({ id: "p2", name: "Fast drafts" }),
    ];
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
      settings: { mode: "high" },
    };
    const node = mount(picker());
    expect(node.textContent).toContain("Saved profiles");
    expect(node.textContent).toContain("Deep review");
    for (const label of [
      "Provider",
      "Harness",
      "Model",
      "Thinking",
      "Subagents",
    ])
      expect(node.textContent).toContain(label);
    expect(node.textContent).toContain("GLM 5.3 · CurveBender");
    expect(node.textContent).toContain("Claude Opus 5.5");
    expect(node.textContent).toContain("Edit profile");
    click(node, "Manage");
    expect(state.navigateSettings).toHaveBeenCalledWith("profiles");
  });

  /** TEST_SCENARIO: "Edit profile" opens that profile's editor on Settings › Profiles, addressed by the profile's id, rather than the old Providers tab. */
  it("edits a profile on the Settings › Profiles page", () => {
    profilesState = [profile({ model: "ibm/aws/claude-opus-5-5" })];
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(picker());
    click(node, "Using profile");
    click(node, "Edit profile");
    expect(state.navigateSettings).toHaveBeenCalledWith("profiles", {
      profileId: "p1",
    });
  });

  /** TEST_SCENARIO: switching between the custom fields and the profiles view lands focus on the first control of the new view, so keyboard users keep their place. */
  it("moves focus when the view switches", () => {
    profilesState = [
      profile({ name: "Deep review", model: "ibm/aws/claude-opus-5-5" }),
    ];
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(picker());
    click(node, "Using profile");
    act(() =>
      [...node.querySelectorAll<HTMLElement>("button")]
        .find((b) => b.textContent?.includes("Back to custom"))
        ?.click(),
    );
    expect(document.activeElement).toBe(
      node.querySelector('button[aria-labelledby*="-harness-label"]'),
    );
    act(() =>
      [...node.querySelectorAll<HTMLElement>("button")]
        .find((b) => b.textContent?.includes("Using profile"))
        ?.click(),
    );
    expect(document.activeElement?.textContent).toContain("Back to custom");
  });

  /** TEST_SCENARIO: a non-default setting under More options is not hidden: More options opens by itself so the changed setting is visible, while a default pick, or a non-default effort that the main panel already shows, leaves it closed. */
  it("opens More options while a setting differs from its default", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
    };
    const plain = mount(picker());
    expect(
      plain
        .querySelector('[aria-controls$="-more"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    act(() => root!.unmount());
    root = null;
    container.remove();
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
      settings: { mode: "high" },
    };
    const effort = mount(picker());
    expect(
      effort
        .querySelector('[aria-controls$="-more"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    act(() => root!.unmount());
    root = null;
    container.remove();
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
      settings: { cacheTtl: "1h" },
    };
    const changed = mount(
      picker({
        carried: [{ ...carried[0]!, sessionSettings: ["mode", "cacheTtl"] }],
      }),
    );
    expect(
      changed
        .querySelector('[aria-controls$="-more"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(changed.textContent).toContain("Prompt cache");
  });

  /** TEST_SCENARIO: with a profile selected, the bottom entry names it ("Using profile “…”") and still opens the profiles view; without one it reads "Use a profile". */
  it("names the selected profile on the bottom entry", () => {
    profilesState = [profile({ name: "Deep review" })];
    state.chosen = {
      harness: "pi",
      provider: "curve",
      model: "cb/rits/zai-org/glm-5-3",
    };
    const node = mount(picker());
    expect(node.textContent).toContain("Using profile “Deep review”");
    act(() =>
      [...node.querySelectorAll<HTMLElement>("button")]
        .find((b) => b.textContent?.includes("Using profile"))
        ?.click(),
    );
    expect(node.textContent).toContain("Saved profiles");
  });

  /** TEST_SCENARIO: "Use a profile" at the bottom opens that view; Back to custom returns to the dropdowns; the panel reopens on the profiles while a profile is in use. */
  it("walks from the dropdowns to the profiles and back", () => {
    profilesState = [profile()];
    const node = mount(picker());
    click(node, "Use a profile");
    expect(node.textContent).toContain("Saved profiles");
    click(node, "Back to custom");
    expect(menuTrigger(node, "model")).toBeDefined();
    expect(node.textContent).toContain("Use a profile");
  });

  /** TEST_SCENARIO: picking a profile applies its harness, model, settings and subagent together, and marks it in use. */
  it("applies a profile's values and inherits its subagent", () => {
    profilesState = [
      profile({
        id: "p1",
        name: "Deep review",
        model: "ibm/aws/claude-opus-5-5",
        providerTemplate: "ibm-litellm",
        settings: { mode: "high" },
        subagent: {
          providerTemplate: "curve-bender",
          model: "cb/rits/zai-org/glm-5-3",
        },
      }),
    ];
    const node = mount(picker());
    click(node, "Use a profile");
    profileRow(node, "Deep review");
    const [, pair, , , references] = lastCall(state.remember);
    expect(pair).toEqual(
      expect.objectContaining({
        harness: "pi",
        provider: "ibm",
        model: "ibm/aws/claude-opus-5-5",
        settings: { mode: "high" },
      }),
    );
    expect(references).toEqual({
      profileId: "p1",
      platformSubagentProfileId: null,
    });
  });

  /** TEST_SCENARIO: a profile whose harness this agent cannot offer is refused with the reason, and picking it changes nothing (QA: a Hermes profile, with the Hermes feature off, was offered in a Codex agent's chip, and picking it silently ran the agent on Pi). */
  it("refuses a profile whose harness this agent cannot run", () => {
    profilesState = [profile({ harness: "hermes", name: "qa-hermes" })];
    const node = mount(picker({ carried: [...carried, claudeCode] }));
    click(node, "Use a profile");
    expect(node.textContent).toContain("Hermes isn't available for this agent");
    const row = [...node.querySelectorAll<HTMLButtonElement>("li button")].find(
      (b) => b.textContent?.includes("qa-hermes"),
    );
    expect(row).toBeDefined();
    expect(row!.disabled).toBe(true);
    act(() => row!.click());
    expect(state.remember).not.toHaveBeenCalled();
    expect(state.chosenModel).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a profile that cannot run here stays listed, disabled, with its reason and the one action that fixes it. */
  it("keeps an unavailable profile listed with its reason", () => {
    profilesState = [
      profile({
        id: "p2",
        name: "Local only",
        availability: {
          available: false,
          reason: "CurveBender is not connected",
          attachable: false,
        },
      }),
    ];
    const node = mount(picker());
    click(node, "Use a profile");
    expect(node.textContent).toContain("No profiles fit this session.");
  });
});

describe("a config page's picker", () => {
  const emptySlots = {
    profileId: null,
    pair: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };
  const defaultPair: SessionPair = {
    harness: "pi",
    provider: "ibm",
    model: "ibm/azure/gpt-5.5",
    settings: { mode: "high" },
  };
  const targetOf = (overrides: Record<string, unknown> = {}) => ({
    slots: emptySlots,
    label: "Model for schedules",
    placeholder: "Use agent default",
    agentDefault: {
      detail: "Follows GPT 5.5 · High · IBM proxy",
      harness: "pi",
      pair: defaultPair,
      onClear: vi.fn(),
    },
    onChoose: vi.fn(),
    ...overrides,
  });

  /** TEST_SCENARIO: a config page shows the pick as a card whose title is the pair's summary (never a profile's name) or the default it follows, and the same body opens from it. */
  it("reads the pick on a card that opens the same body", () => {
    const emptySlots = {
      profileId: null,
      pair: null,
      platformSubagentProfileId: null,
      platformSubagentSettings: null,
    };
    const node = mount(
      picker({
        row: true,
        target: {
          slots: {
            ...emptySlots,
            pair: {
              harness: "pi",
              provider: "ibm",
              model: "ibm/aws/claude-opus-5-5",
            },
          },
          label: "Default model",
          placeholder: "Choose a model",
          onChoose: vi.fn(),
        },
      }),
    );
    const card = node.querySelector('[data-testid="session-pair-row-picker"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Claude Opus 5.5 · Low · IBM proxy");
    expect(card?.textContent).toContain("Pi");
    expect(menuTrigger(node, "model")).toBeDefined();
    expect(
      node.querySelector('[data-testid="session-pair-picker"]'),
    ).toBeNull();
  });

  /** TEST_SCENARIO: a page following the agent's default reads "Use agent default" over what it follows on its card; one with no default says so. */
  it("reads the agent's default on the card", () => {
    const target = (detail: string) => ({
      slots: {
        profileId: null,
        pair: null,
        platformSubagentProfileId: null,
        platformSubagentSettings: null,
      },
      label: "Model for channels",
      placeholder: "Use agent default",
      agentDefault: {
        detail,
        harness: "pi",
        pair: null,
        onClear: vi.fn(),
      },
      onChoose: vi.fn(),
    });
    const following = mount(
      picker({
        row: true,
        target: target("Follows GPT 5.5 · High · IBM proxy"),
      }),
    );
    const card = following.querySelector(
      '[data-testid="session-pair-row-picker"]',
    );
    expect(card?.textContent).toContain("Use agent default");
    expect(card?.textContent).toContain("Follows GPT 5.5 · High · IBM proxy");
    act(() => root!.unmount());
    root = null;
    container.remove();
    const none = mount(
      picker({ row: true, target: target("No default set yet") }),
    );
    expect(
      none.querySelector('[data-testid="session-pair-row-picker"]')
        ?.textContent,
    ).toContain("No default set yet");
  });

  /** TEST_SCENARIO: a channel or a schedule follows the agent's default until its switch is turned off: its values read-only while on, and copied into its own pick when it is turned off. */
  it("reads the agent's default read-only until the switch is turned off", () => {
    const target = targetOf();
    const node = mount(picker({ row: true, target }));
    const toggle = node.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(
      node.querySelector('button[aria-labelledby$="-model-label"]'),
    ).toBeNull();
    expect(node.textContent).toContain("GPT 5.5");
    expect(node.textContent).toContain("High");
    act(() => toggle.click());
    expect(target.onChoose).toHaveBeenCalledWith(
      defaultPair,
      { profileId: null },
      defaultPair,
    );
    expect(target.agentDefault.onClear).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a page with its own pick shows the dropdowns and turns the default on by clearing the pick. */
  it("clears the page's own pick when the switch is turned on", () => {
    const target = targetOf({
      slots: {
        ...emptySlots,
        pair: { harness: "pi", provider: "ibm", model: "ibm/gpt-5.5" },
      },
    });
    const node = mount(picker({ row: true, target }));
    const toggle = node.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(menuTrigger(node, "model")).toBeDefined();
    act(() => toggle.click());
    expect(target.agentDefault.onClear).toHaveBeenCalled();
  });
});

describe("a pick that follows a default", () => {
  /* UNIT_BOUNDARY_DESCRIPTION: one family tier, two names for its model: CurveBender's and IBM's. */
  const tierCatalog = () => ({
    harness: "pi",
    routed: true,
    providers: [
      {
        connectionId: "curve",
        alias: "cb",
        template: "curve-bender",
        displayName: "Curve",
        status: "listed" as const,
        listedAt: null,
        models: [modelView("cb", "rits/zai-org/glm-5-3")],
      },
      {
        connectionId: "shared",
        alias: "cb",
        template: "curve-bender-deployment",
        displayName: "Shared",
        status: "listed" as const,
        listedAt: null,
        models: [
          modelView("cb", "rits/zai-org/glm-5-3"),
          modelView("cb", "rits/deepseek-ai/DeepSeek-V4.1-Flash"),
        ],
      },
      {
        connectionId: "ibm",
        alias: "ibm",
        template: "ibm-litellm",
        displayName: "IBM",
        status: "listed" as const,
        listedAt: null,
        models: [modelView("ibm", "zai-org/glm-5-3")],
      },
    ],
  });
  const deepseek = "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash";
  const glm = "cb/rits/zai-org/glm-5-3";
  const shared = {
    id: "shared",
    name: "Shared",
    type: "curve-bender",
    templateId: "curve-bender-deployment",
  };
  const twoCurveCatalog = () => ({
    harness: "pi",
    routed: true,
    providers: [
      {
        connectionId: "curve",
        alias: "cb",
        template: "curve-bender",
        displayName: "Curve",
        status: "listed" as const,
        listedAt: null,
        models: [
          modelView("cb", "rits/zai-org/glm-5-3"),
          modelView("cb", "rits/deepseek-ai/DeepSeek-V4.1-Flash"),
        ],
      },
      {
        connectionId: "shared",
        alias: "cb",
        template: "curve-bender-deployment",
        displayName: "Shared",
        status: "listed" as const,
        listedAt: null,
        models: [
          modelView("cb", "rits/zai-org/glm-5-3"),
          modelView("cb", "rits/deepseek-ai/DeepSeek-V4.1-Flash"),
        ],
      },
    ],
  });
  const emptySlots = {
    profileId: null,
    pair: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };
  const targetOf = (overrides: Record<string, unknown> = {}) => ({
    slots: emptySlots,
    label: "Schedule harness and model",
    placeholder: "The agent's model for schedules",
    defaultPair: { harness: "pi", provider: "shared", model: deepseek },
    onChoose: vi.fn(),
    ...overrides,
  });
  const providerRow = (node: ParentNode) =>
    node.querySelector<HTMLElement>('[aria-label^="Provider:"]');

  /** TEST_SCENARIO: with nothing picked, the panel's Provider row names the Connection the default runs on, not the first one that runs the harness (QA: two CurveBender Connections list one alias). */
  it("shows the default's provider while no model is picked", () => {
    state.catalog = twoCurveCatalog();
    state.granted = [shared];
    const node = mount(picker({ target: targetOf() }));
    expect(providerRow(node)?.textContent).toBe("Shared");
  });

  /** TEST_SCENARIO: picking a provider with no model picked starts on the default's model, which both Connections offer, not on the menu's first model. */
  it("starts a picked provider on the default's model", () => {
    state.catalog = twoCurveCatalog();
    state.granted = [shared];
    const target = targetOf();
    const node = mount(picker({ target }));
    pickMenu(node, "Provider", "Curve");
    expect(target.onChoose).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: "pi",
        provider: "curve",
        model: deepseek,
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  /** TEST_SCENARIO: a pair's own Connection is what the Provider row shows, even where another Connection of the same alias lists the same model name, so a pick reads back as the Connection it was made on. */
  it("reads a pair's provider beside its twin", () => {
    state.catalog = twoCurveCatalog();
    state.granted = [shared];
    state.chosen = { harness: "pi", provider: "shared", model: glm };
    const node = mount(picker());
    expect(providerRow(node)?.textContent).toBe("Shared");
  });

  /** TEST_SCENARIO: a harness switch whose current Connection cannot run the new harness lands on the default's Connection, not the first one that can, so a pick never moves to the own-key twin by accident. */
  it("keeps the default's Connection when the current one cannot run the harness", () => {
    state.catalog = twoCurveCatalog();
    state.granted = [shared, { id: "oai", name: "OpenAI", type: "openai" }];
    const target = targetOf({
      slots: {
        ...emptySlots,
        pair: { harness: "codex", provider: "oai", model: "openai/gpt-5.5" },
      },
      defaultPair: { harness: "codex", provider: "shared", model: deepseek },
    });
    const node = mount(
      picker({
        target,
        defaultHarness: "codex",
        carried: [...carried, { ...carried[0]!, name: "codex" }, claudeCode],
      }),
    );
    pickMenu(node, "Harness", "Claude Code");
    expect(target.onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ harness: "claude-code", provider: "shared" }),
      expect.anything(),
      expect.anything(),
    );
  });

  /** TEST_SCENARIO: saving a pick on the shared CurveBender as a profile keeps that Connection's template, so the profile runs where the pick does and never on the own-key twin. */
  it("saves a pick as a profile on its own template", () => {
    state.catalog = twoCurveCatalog();
    state.granted = [shared];
    state.chosen = { harness: "pi", provider: "shared", model: deepseek };
    const node = mount(picker());
    openMore(node);
    click(node, "Save as profile");
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Profile name"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Shared review");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(document.body, "Save profile");
    expect(state.profileMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Shared review",
        providerTemplate: "curve-bender-deployment",
        model: deepseek,
      }),
      expect.anything(),
    );
  });

  /** TEST_SCENARIO: a schedule or a channel following a profile on the shared CurveBender reads that Connection, not the own-key twin that also lists the model. */
  it("reads a profile's own Connection beside its twin", () => {
    profilesState = [
      profile({
        name: "Shared review",
        providerTemplate: "curve-bender-deployment",
      }),
    ];
    state.catalog = twoCurveCatalog();
    state.granted = [shared];
    const node = mount(
      picker({
        target: targetOf({ slots: { ...emptySlots, profileId: "p1" } }),
      }),
    );
    expect(providerRow(node)?.textContent).toBe("Shared");
  });

  /** TEST_SCENARIO: picking a profile takes the Connection of the profile's template, so a pick on the shared CurveBender never moves to the own-key twin that lists the same model. */
  it("picks a profile onto its own Connection", () => {
    profilesState = [
      profile({
        name: "Shared review",
        providerTemplate: "curve-bender-deployment",
      }),
    ];
    state.catalog = twoCurveCatalog();
    state.granted = [shared];
    const target = targetOf();
    const node = mount(picker({ target }));
    click(node, "Use a profile");
    profileRow(node, "Shared review");
    expect(target.onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "shared" }),
      expect.anything(),
      expect.anything(),
    );
  });

  /** TEST_SCENARIO: a family tier that holds another provider's name for the model still reads the pair's own model, so a stale Connection never names the row while the pair holds another provider's name for it. */
  it("reads the pair's model inside a shared family tier", () => {
    state.catalog = tierCatalog();
    state.granted = [shared];
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "cb/rits/zai-org/glm-5-3",
    };
    const node = mount(picker());
    expect(providerRow(node)?.textContent).toBe("Curve");
  });

  /** TEST_SCENARIO: a harness switch inherits the default's model only where the Connection it keeps offers the model; otherwise it takes that Connection's first model instead of moving the pick to another Connection. */
  it("keeps the chosen Connection when it does not offer the default's model", () => {
    state.catalog = tierCatalog();
    state.granted = [shared];
    const target = targetOf({
      slots: {
        ...emptySlots,
        pair: { harness: "pi", provider: "ibm", model: null },
      },
    });
    const node = mount(
      picker({
        target,
        carried: [...carried, { ...carried[0]!, name: "codex" }],
      }),
    );
    pickMenu(node, "Harness", "Codex");
    expect(target.onChoose).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: "codex",
        provider: "ibm",
        model: "ibm/zai-org/glm-5-3",
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  /** TEST_SCENARIO: a harness switch takes the default's model where the new harness offers it, not the first model the harness lists. */
  it("takes the default's model on a harness switch", () => {
    state.catalog = twoCurveCatalog();
    state.owned = [shared];
    state.granted = [shared];
    const target = targetOf({
      defaultPair: { harness: "pi", provider: "shared", model: deepseek },
    });
    const node = mount(
      picker({
        target,
        carried: [...carried, { ...carried[0]!, name: "codex" }],
      }),
    );
    pickMenu(node, "Harness", "Codex");
    expect(target.onChoose).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: "codex",
        provider: "shared",
        model: deepseek,
      }),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("an open session's picker", () => {
  const session = (props: Record<string, unknown> = {}) =>
    createElement(ModelIndicator, {
      onToolApproval: () => {},
      agentId: "agent",
      sessionId: "s1",
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
      carried,
      routed: true,
      onChoose: vi.fn(),
      onConfigure: vi.fn(),
      onNewSession: state.newSession,
      ...props,
    });

  /** TEST_SCENARIO: the harness is set for the session's life, so it reads as text with a focusable (i) that says so and links to a new session instead of a dropdown. */
  it("locks the harness behind an (i) that starts a new session", () => {
    const html = renderToStaticMarkup(session());
    expect(html).not.toContain('-harness"');
    expect(html).toContain('aria-label="Why can&#x27;t I change the harness?"');
    expect(html).toContain("The harness is set when a session starts.");
    expect(html).toContain("start a new session");
  });

  /** TEST_SCENARIO: a model picked in the running session applies to the next message, and a profile pick applies its values the same way. */
  it("picks a model for the running session", () => {
    const onChoose = vi.fn();
    const node = mount(session({ onChoose, turnRunning: true }));
    expect(node.textContent).toContain("applies to the next message");
    pickMenu(node, "Model", "Claude Opus 5.5");
    expect(onChoose).toHaveBeenCalledWith("ibm/aws/claude-opus-5-5", {});
  });

  /** TEST_SCENARIO: a running session's configure patch is settled by the UI against its own pair and full settings: an effort-only change keeps the platform slot and brings its native effort along. */
  it("settles an effort-only change with the session's slot", () => {
    state.catalog = {
      ...claudeCatalog,
      providers: [...claudeCatalog.providers, routedCatalog.providers[1]!],
    };
    const onConfigure = vi.fn();
    const node = mount(
      session({
        carried: [claudeCode],
        harness: "claude-code",
        provider: "ibm",
        model: "ibm/aws/claude-opus-5-5",
        settings: {
          effort: "medium",
          subagentModel: "ibm/aws/claude-haiku-5-5",
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "ibm/aws/claude-haiku-5-5",
          "platformSubagent.effort": "low",
        },
        onConfigure,
      }),
    );
    pickEffort(node, "High");
    expect(onConfigure).toHaveBeenCalledWith({
      effort: "high",
      subagentEffort: "low",
    });
  });

  /** TEST_SCENARIO: reselecting the subagent's current provider re-derives the same native model, so the patch is empty and the session is not reconfigured. */
  it("sends nothing when the subagent is reselected unchanged", () => {
    state.catalog = {
      ...claudeCatalog,
      providers: [...claudeCatalog.providers, routedCatalog.providers[1]!],
    };
    const onConfigure = vi.fn();
    const node = mount(
      session({
        carried: [claudeCode],
        harness: "claude-code",
        provider: "ibm",
        model: "ibm/aws/claude-opus-5-5",
        settings: {
          subagentModel: "ibm/aws/claude-haiku-5-5",
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "ibm/aws/claude-haiku-5-5",
        },
        onConfigure,
      }),
    );
    pickMenu(node, "Subagent provider", "IBM");
    expect(onConfigure).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: switching the primary to a provider that does not offer the subagent model removes the native keys the patch had, while the platform slot stays. */
  it("recomputes eligibility on a primary provider switch", () => {
    state.catalog = {
      ...claudeCatalog,
      providers: [...claudeCatalog.providers, routedCatalog.providers[1]!],
    };
    const onChoose = vi.fn();
    const node = mount(
      session({
        carried: [claudeCode],
        harness: "claude-code",
        provider: "ibm",
        model: "ibm/aws/claude-opus-5-5",
        settings: {
          subagentModel: "ibm/aws/claude-haiku-5-5",
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "ibm/aws/claude-haiku-5-5",
        },
        onChoose,
      }),
    );
    pickMenu(node, "Model", "GLM 5.3");
    expect(onChoose).toHaveBeenCalledWith("cb/rits/zai-org/glm-5-3", {
      subagentModel: "",
    });
  });

  /** TEST_SCENARIO: a session loaded without a settled patch still gets its native model derived from the slot on the next change, so nothing waits on relay state. */
  it("derives from the slot on a loaded session", () => {
    state.catalog = {
      ...claudeCatalog,
      providers: [...claudeCatalog.providers, routedCatalog.providers[1]!],
    };
    const onConfigure = vi.fn();
    const node = mount(
      session({
        carried: [claudeCode],
        harness: "claude-code",
        provider: "ibm",
        model: "ibm/aws/claude-opus-5-5",
        settings: {
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "ibm/aws/claude-haiku-5-5",
        },
        onConfigure,
      }),
    );
    pickMenu(node, "Subagent provider", "IBM");
    expect(onConfigure).toHaveBeenCalledWith({
      subagentModel: "ibm/aws/claude-haiku-5-5",
    });
  });

  /** TEST_SCENARIO: a pinned model keeps the old provider in session metadata; the session resolves the provider from the model's own group, so reselecting the unchanged subagent sends nothing, the body shows that provider, and another subagent there derives its native model. */
  it("resolves the provider from the pinned model, not the stale field", () => {
    state.catalog = {
      ...claudeCatalog,
      providers: [
        claudeCatalog.providers[0]!,
        {
          ...routedCatalog.providers[1]!,
          models: [
            modelView("cb", "rits/zai-org/glm-5-3"),
            modelView("cb", "aws/claude-sonnet-5-5"),
            modelView("cb", "aws/claude-haiku-5-5"),
          ],
        },
      ],
    };
    const onConfigure = vi.fn();
    const node = mount(
      session({
        carried: [claudeCode],
        harness: "claude-code",
        provider: "ibm",
        model: "cb/rits/zai-org/glm-5-3",
        settings: {
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "cb/aws/claude-sonnet-5-5",
          subagentModel: "cb/aws/claude-sonnet-5-5",
        },
        onConfigure,
      }),
    );
    expect(node.textContent).toContain("Curve");
    pickMenu(node, "Subagent provider", "Curve");
    expect(onConfigure).not.toHaveBeenCalled();

    pickMenu(node, "Subagent model", "Claude Haiku 5.5");
    expect(onConfigure).toHaveBeenCalledWith({
      "platformSubagent.model": "cb/aws/claude-haiku-5-5",
      subagentModel: "cb/aws/claude-haiku-5-5",
    });
  });

  /** TEST_SCENARIO: an unlisted primary model (the catalog is down or the model is gone) still resolves its provider by alias: the row shows that Connection instead of the stale IBM field, and no IBM native subagent is derived because compatibility is unknown. */
  it("does not trust the stale provider when the primary model is unlisted", () => {
    state.catalog = claudeCatalog;
    const onConfigure = vi.fn();
    const node = mount(
      session({
        carried: [claudeCode],
        harness: "claude-code",
        provider: "ibm",
        model: "cb/rits/zai-org/glm-5-3",
        settings: {
          "platformSubagent.harness": "claude-code",
          "platformSubagent.model": "ibm/aws/claude-haiku-5-5",
        },
        onConfigure,
      }),
    );
    expect(node.querySelector('[aria-label="Provider: IBM"]')).toBeNull();
    expect(node.querySelector('[aria-label="Provider: Curve"]')).not.toBeNull();
    pickMenu(node, "Subagent provider", "IBM");
    expect(onConfigure).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a running Claude session on IBM picks a subagent model from CurveBender: the config it sends is the platform slot alone, with no native key the run boundary derives. */
  it("sends a running session's subagent pick platform-level", () => {
    state.catalog = {
      ...claudeCatalog,
      providers: [...claudeCatalog.providers, routedCatalog.providers[1]!],
    };
    const onConfigure = vi.fn();
    const node = mount(
      session({
        carried: [claudeCode],
        harness: "claude-code",
        provider: "ibm",
        model: "ibm/aws/claude-opus-5-5",
        onConfigure,
      }),
    );
    openMore(node);
    pickMenu(node, "Subagent model", "GLM 5.3");
    expect(onConfigure).toHaveBeenCalledWith({
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "cb/rits/zai-org/glm-5-3",
    });
    const sent = lastCall(onConfigure)[0] as Record<string, string>;
    expect(sent.subagentModel).toBeUndefined();
    expect(sent.subagentEffort).toBeUndefined();
  });

  /** TEST_SCENARIO: a running session keeps its harness, so its profiles are the ones that run on it. */
  it("offers only the profiles the session's harness runs", () => {
    profilesState = [
      profile({ id: "p1", name: "Pi profile" }),
      profile({
        id: "p2",
        name: "Claude profile",
        harness: "claude-code",
        model: "cb/rits/zai-org/glm-5-3",
      }),
    ];
    const node = mount(session());
    click(node, "Use a profile");
    expect(node.textContent).toContain("Pi profile");
    expect(node.textContent).not.toContain("Claude profile");
  });

  /** TEST_SCENARIO: the profile a session's pick came from is remembered for that session alone, so another session offers a new profile rather than overwriting it. */
  it("does not carry the picked profile into another session", () => {
    profilesState = [
      profile({
        model: "ibm/aws/claude-opus-5-5",
        providerTemplate: "ibm-litellm",
      }),
    ];
    const node = mount(session({ model: "ibm/aws/claude-opus-5-5" }));
    click(node, "Using profile");
    profileRow(node, "Fast review");
    click(node, "Back to custom");
    openMore(node);
    expect(node.textContent).toContain("Save as a new profile");
    act(() => root!.unmount());
    root = null;
    container.remove();
    const other = mount(
      session({ sessionId: "s2", model: "ibm/aws/claude-haiku-5-5" }),
    );
    openMore(other);
    expect(other.textContent).toContain("Save as profile");
    expect(other.textContent).not.toContain("Save as a new profile");
  });
});

describe("the picker editing a profile in Settings", () => {
  /** TEST_SCENARIO: Settings edits a profile on the same body, with no profile view, no save row and no tool approval, and a pick goes to the profile rather than an agent's next session. */
  it("hands a pick to the profile", () => {
    const onChoose = vi.fn();
    state.catalog = {
      harness: "pi",
      routed: true,
      providers: [
        {
          connectionId: "curve",
          alias: "cb",
          template: "curve-bender",
          displayName: "Curve",
          status: "listed",
          listedAt: null,
          models: [modelView("cb", "owner-only")],
        },
      ],
    };
    const node = mount(
      picker({
        agentId: null,
        edit: {
          pair: {
            harness: "pi",
            provider: "curve",
            model: "cb/rits/zai-org/glm-5-3",
          },
          providerName: "Curve",
          onChoose,
        },
      }),
    );
    expect(node.textContent).not.toContain("Use a profile");
    expect(node.textContent).not.toContain("Save as profile");
    pickMenu(node, "Model", "owner-only");
    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ model: "cb/owner-only" }),
    );
    expect(state.chosenModel).not.toHaveBeenCalled();
  });
});

describe("a model from a provider the agent is not connected to", () => {
  /** TEST_SCENARIO: switching to a provider the owner holds but the agent lacks asks first, then grants it and applies its first model; a cancel changes nothing. */
  it("asks to connect the provider, then grants it and applies the pick", async () => {
    state.catalog = {
      ...routedCatalog,
      providers: [
        ...routedCatalog.providers,
        {
          connectionId: "anth",
          alias: "anthropic",
          template: "anthropic",
          displayName: "Anthropic",
          status: "listed" as const,
          listedAt: null,
          models: [modelView("anthropic", "claude-opus-5-5")],
        },
      ],
    };
    state.owned = [
      {
        id: "anth",
        name: "Anthropic",
        type: "anthropic",
        templateId: "anthropic",
      } as never,
    ];
    const node = mount(picker());
    state.showConfirm.mockResolvedValueOnce(false);
    clickMenu(node, "Anthropic");
    await act(async () => {});
    expect(state.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining("every model Anthropic offers"),
      "Connect Anthropic to this agent?",
      { confirmLabel: "Connect" },
    );
    expect(state.grant).not.toHaveBeenCalled();
    expect(state.chosenModel).not.toHaveBeenCalled();

    act(() => root!.unmount());
    root = null;
    container.remove();
    const confirming = mount(picker());
    state.showConfirm.mockResolvedValueOnce(true);
    clickMenu(confirming, "Anthropic");
    await act(async () => {});
    expect(state.grant).toHaveBeenCalledWith("anth");
    expect(state.chosenModel).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        provider: "anth",
        model: "anthropic/claude-opus-5-5",
      }),
    );
  });
});

describe("the old runtime path", () => {
  /** TEST_SCENARIO: an agent whose runtime does not route by model name keeps today's per-provider model lists, leaving the routed panel to runtimes that do. */
  it("lists each attached provider's models under its own heading", () => {
    state.models = {
      ibm: { availableModels: [{ value: "ibm-model", name: "IBM model" }] },
      curve: {
        availableModels: [{ value: "curve-model", name: "Curve model" }],
      },
    };
    const html = renderToStaticMarkup(picker({ routed: false }));
    expect(html).toContain("IBM model");
    expect(html).toContain("Curve model");
    expect(html).toContain('aria-label="Session settings"');
    expect(html).not.toContain("More options");
  });
});

describe("the slots a pick stores", () => {
  /** TEST_SCENARIO: a subagent edit names both stored slots, so the edit reaches the chat default instead of being left out; the pair carries the subagent as its own values. */
  it("writes a subagent edit as the slot's own values", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
    };
    const node = mount(picker());
    openMore(node);
    pickMenu(node, "Subagent model", "Claude Haiku 5.5");
    const [, pair, , , references] = lastCall(state.remember);
    expect(pair.settings).toMatchObject({
      "platformSubagent.harness": "pi",
      "platformSubagent.model": "ibm/aws/claude-haiku-5-5",
    });
    expect(references).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });
  });

  /** TEST_SCENARIO: "Same as agent" writes the empty subagent slot, so a carried choice is cleared rather than left as it was. */
  it("clears the slot for Same as agent", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
      settings: {
        "platformSubagent.harness": "pi",
        "platformSubagent.model": "ibm/aws/claude-opus-5-5",
      },
    };
    const node = mount(picker());
    pickMenu(node, "Subagent model", "Same as agent");
    const [, pair, , , references] = lastCall(state.remember);
    expect(pair.settings).toBeUndefined();
    expect(references).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });
  });

  /** TEST_SCENARIO: a subagent-only edit leaves the primary's values as they were, so the profile they match stays the stored reference and its later edits still reach the chat. */
  it("keeps the primary profile reference on a subagent-only edit", () => {
    profilesState = [
      profile({
        model: "ibm/aws/claude-haiku-5-5",
        providerTemplate: "ibm-litellm",
        settings: { mode: "high" },
      }),
    ];
    state.saved = { chatProfileId: "p1" };
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-haiku-5-5",
      settings: { mode: "high" },
    };
    const node = mount(picker());
    openMore(node);
    pickMenu(node, "Subagent model", "Claude Opus 5.5");
    const [, , , , references] = lastCall(state.remember);
    expect(references).toEqual({
      profileId: "p1",
      platformSubagentProfileId: null,
    });
  });
});

describe("the subagent a page inherits from its profile", () => {
  const emptySlots = {
    profileId: null,
    pair: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };
  const targetOf = (overrides: Record<string, unknown> = {}) => ({
    slots: emptySlots,
    label: "Default model",
    placeholder: "Choose a model",
    onChoose: vi.fn(),
    ...overrides,
  });
  const lent = {
    providerTemplate: "curve-bender",
    model: "cb/rits/zai-org/glm-5-3",
  };

  /** TEST_SCENARIO: a page whose primary names a profile shows the subagent that profile lends; a primary change detaches the profile, so the lent subagent is materialized into the page's own slot rather than silently dropped. */
  it("shows a lent subagent and leaves it lent on a primary change", () => {
    profilesState = [profile({ subagent: lent })];
    const target = targetOf({
      slots: { ...emptySlots, profileId: "p1" },
    });
    const node = mount(picker({ row: true, target }));
    expect(node.textContent).toContain("Subagents");
    expect(menuTrigger(node, "subagent-model")).toContain("GLM 5.3");
    pickMenu(node, "Model", "Claude Haiku 5.5");
    const [pair, references, effective] = lastCall(target.onChoose);
    expect(pair.settings?.["platformSubagent.model"]).toBe(
      "cb/rits/zai-org/glm-5-3",
    );
    expect(effective.settings?.["platformSubagent.model"]).toBe(
      "cb/rits/zai-org/glm-5-3",
    );
    expect(references).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });
  });

  /** TEST_SCENARIO: saving a page's pick as a new profile carries the subagent its profile lends, rather than writing null over it. There is no Update action in the picker. */
  it("saves the lent subagent with a new profile", () => {
    profilesState = [profile({ name: "Deep review", subagent: lent })];
    const target = targetOf({
      slots: { ...emptySlots, profileId: "p1" },
    });
    const node = mount(picker({ row: true, target }));
    click(node, "Using profile");
    profileRow(node, "Deep review");
    click(node, "Back to custom");
    click(node, "Save as a new profile");
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Profile name"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Saved");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(document.body, "Save profile");
    expect(state.profileMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Saved", subagent: lent }),
      expect.anything(),
    );
  });
});

describe("a model listing's own states", () => {
  /** TEST_SCENARIO: a first load that fails says so and offers a retry, instead of an empty model list that looks like a provider with no models. */
  it("reports a failed load and retries it", () => {
    state.catalog = undefined;
    state.catalogError = true;
    const node = mount(picker());
    expect(node.textContent).toContain("Couldn't load the models.");
    click(node, "Retry");
    expect(state.refetch).toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a listed harness with no models says it is empty, not that it failed. */
  it("reports an empty listing", () => {
    state.catalog = { ...routedCatalog, providers: [] };
    const node = mount(picker());
    expect(node.textContent).toContain("No models available.");
    expect(node.textContent).not.toContain("Couldn't load the models.");
  });

  /** TEST_SCENARIO: a provider whose listing failed reads as such, apart from a listed provider that simply lacks the picked model. */
  it("tells a failed provider apart from one that lacks the model", () => {
    state.catalog = {
      ...routedCatalog,
      providers: [
        routedCatalog.providers[0]!,
        {
          ...routedCatalog.providers[1]!,
          models: [],
          status: "unavailable" as const,
        },
        {
          connectionId: "anth",
          alias: "anthropic",
          template: "anthropic",
          displayName: "Anthropic",
          status: "listed" as const,
          listedAt: null,
          models: [modelView("anthropic", "claude-haiku-5-5")],
        },
      ],
    } as unknown as typeof routedCatalog;
    state.owned = [
      {
        id: "anth",
        name: "Anthropic",
        type: "anthropic",
        templateId: "anthropic",
      } as never,
    ];
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(picker());
    expect(node.textContent).toContain(
      "Curve: Couldn't list this provider's models.",
    );
    const curve = menuItem(node, "Curve");
    expect(curve.getAttribute("aria-disabled")).toBe("true");
    expect(curve.getAttribute("data-tooltip")).toContain(
      "Couldn't list this provider's models.",
    );
    const anthropic = menuItem(node, "Anthropic");
    expect(anthropic.getAttribute("aria-disabled")).toBe("true");
    expect(anthropic.getAttribute("data-tooltip")).toContain(
      "Doesn't offer Claude Opus 5.5 for Pi",
    );
    expect(anthropic.textContent).not.toMatch(/\d+ models?/);
  });
});

describe("a page with no agent default to follow", () => {
  /** TEST_SCENARIO: with no default to copy, turning the switch off still opens the page's own pick, on the default harness with no model, instead of staying disabled. */
  it("starts a draft on the default harness", () => {
    const emptySlots = {
      profileId: null,
      pair: null,
      platformSubagentProfileId: null,
      platformSubagentSettings: null,
    };
    const target = {
      slots: emptySlots,
      label: "Model for schedules",
      placeholder: "Use agent default",
      agentDefault: {
        summary: "Not set yet",
        harness: "pi",
        pair: null,
        onClear: vi.fn(),
      },
      onChoose: vi.fn(),
    };
    const node = mount(picker({ row: true, target }));
    const toggle = node.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(false);
    act(() => toggle.click());
    expect(target.onChoose).toHaveBeenCalledWith(
      { harness: "pi", provider: null, model: null },
      { profileId: null },
      { harness: "pi", provider: null, model: null },
    );
  });
});

describe("the profiles view", () => {
  /** TEST_SCENARIO: while the saved profiles are open, the custom controls are gone, so the two views never stack. */
  it("shows the profiles alone, without the custom controls", () => {
    profilesState = [
      profile({ model: "ibm/aws/claude-opus-5-5", settings: {} }),
    ];
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(picker());
    click(node, "Using profile");
    expect(node.textContent).toContain("Saved profiles");
    expect(node.textContent).not.toContain("More options");
    expect(node.querySelector('[id$="-model"]')).toBeNull();
  });
});

describe("references kept apart from effective values", () => {
  const lent = {
    providerTemplate: "curve-bender",
    model: "cb/rits/zai-org/glm-5-3",
  };
  const emptySlots = {
    profileId: null,
    pair: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };
  const targetOf = (overrides: Record<string, unknown> = {}) => ({
    slots: emptySlots,
    label: "Default model",
    placeholder: "Choose a model",
    onChoose: vi.fn(),
    ...overrides,
  });

  /** TEST_SCENARIO: a profile pick stores the reference while the new session runs on the profile's values, so the chat starts with the subagent the profile lends. */
  it("sends the profile's subagent to the new session and inherits the slot", () => {
    profilesState = [
      profile({
        model: "ibm/aws/claude-opus-5-5",
        providerTemplate: "ibm-litellm",
        subagent: lent,
      }),
    ];
    state.saved = { chatProfileId: null };
    const node = mount(picker());
    click(node, "Use a profile");
    profileRow(node, "Fast review");
    const [, stored, , , references, effective] = lastCall(state.remember);
    expect(effective.settings?.["platformSubagent.model"]).toBe(lent.model);
    expect(stored.settings?.["platformSubagent.model"]).toBeUndefined();
    expect(references).toEqual({
      profileId: "p1",
      platformSubagentProfileId: null,
    });
    expect(
      lastCall(state.chosenModel)[1].settings?.["platformSubagent.model"],
    ).toBe(lent.model);
  });

  /** TEST_SCENARIO: a custom model pick detaches the profile; a subagent edit after it keeps the detached reference and the custom model, instead of restoring the profile's model from the Update provenance. */
  it("keeps a custom primary through a later subagent edit", () => {
    profilesState = [
      profile({
        name: "Deep review",
        model: "ibm/aws/claude-opus-5-5",
        providerTemplate: "ibm-litellm",
        settings: { mode: "high" },
      }),
    ];
    state.saved = { chatProfileId: "p1" };
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
      settings: { mode: "high" },
    };
    const first = mount(picker());
    pickMenu(first, "Model", "Claude Haiku 5.5");
    const [, customPair, , , customReferences] = lastCall(state.remember);
    expect(customPair.model).toBe("ibm/aws/claude-haiku-5-5");
    expect(customReferences).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });

    act(() => root!.unmount());
    root = null;
    container.remove();
    state.chosen = customPair;
    state.saved = { chatProfileId: null };
    const second = mount(picker());
    openMore(second);
    pickMenu(second, "Subagent model", "Claude Opus 5.5");
    const [, pair, , , references] = lastCall(state.remember);
    expect(pair.model).toBe("ibm/aws/claude-haiku-5-5");
    expect(references).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });
  });

  /** TEST_SCENARIO: "Same as agent" on a page following a profile detaches that profile with its values and an empty own slot, so the harness picks instead of the slot re-inheriting the profile's subagent. */
  it("clears the subagent by detaching the profile", () => {
    profilesState = [profile({ subagent: lent })];
    const target = targetOf({
      slots: { ...emptySlots, profileId: "p1" },
    });
    const node = mount(picker({ row: true, target }));
    pickMenu(node, "Subagent model", "Same as agent");
    const [stored, references, effective] = lastCall(target.onChoose);
    expect(stored.settings?.["platformSubagent.model"]).toBeUndefined();
    expect(effective.settings?.["platformSubagent.model"]).toBeUndefined();
    expect(references).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });
    expect(stored.model).toBe("cb/rits/zai-org/glm-5-3");
  });

  /** TEST_SCENARIO: an own subagent profile reference survives an unrelated primary edit, so the picker neither converts it into values nor drops it. */
  it("keeps an own subagent reference through a primary edit", () => {
    profilesState = [
      profile({
        id: "psub",
        name: "Subagent",
        harness: "pi",
        model: "ibm/aws/claude-haiku-5-5",
      }),
    ];
    state.saved = { platformSubagentProfileId: "psub" };
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(picker());
    pickMenu(node, "Model", "GLM 5.3");
    const [, stored, , , references] = lastCall(state.remember);
    expect(stored.settings?.["platformSubagent.model"]).toBeUndefined();
    expect(references).toEqual({
      profileId: null,
      platformSubagentProfileId: "psub",
    });
  });

  /** TEST_SCENARIO: native subagent settings a profile or a stored pair carries (Claude Code's subagent model and effort) are not primary settings and survive a primary edit. */
  it("keeps native subagent settings through a primary edit", () => {
    state.catalog = claudeCatalog;
    state.chosen = {
      harness: "claude-code",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
      settings: {
        effort: "high",
        subagentModel: "ibm/aws/claude-opus-5-5",
        subagentEffort: "low",
      },
    };
    const node = mount(
      picker({
        carried: [...carried, claudeCode],
        defaultHarness: "claude-code",
      }),
    );
    clickMenu(node, "Show older versions");
    pickMenu(node, "Model", "GPT 5.5");
    const [, stored] = lastCall(state.remember);
    expect(stored.settings).toMatchObject({
      subagentModel: "ibm/aws/claude-opus-5-5",
      subagentEffort: "low",
    });
  });

  /** TEST_SCENARIO: a provider whose refresh failed but still lists its last models stays selectable with those models; the refresh failure reads separately from a provider that lacks the model. */
  it("keeps cached models selectable after a failed refresh", () => {
    state.catalog = {
      ...routedCatalog,
      providers: [
        routedCatalog.providers[0]!,
        {
          ...routedCatalog.providers[1]!,
          status: "unavailable" as const,
        },
      ],
    } as unknown as typeof routedCatalog;
    const node = mount(picker());
    const curve = menuItem(node, "Curve");
    expect(curve.getAttribute("aria-disabled")).toBeNull();
    expect(curve.getAttribute("data-tooltip")).toContain(
      "Couldn't refresh this provider's models; showing its last listing.",
    );
    expect(node.textContent).toContain(
      "Curve: Couldn't refresh its models; showing its last listing.",
    );
    expect(
      menuItems(node, "Model").map((row) => row.textContent?.trim()),
    ).toContain("GLM 5.3");
  });
});

describe("a real harness's subagent slot", () => {
  const claude = (): HarnessCapability[] => [...carried, claudeCode];
  const lent = {
    providerTemplate: "ibm-litellm",
    model: "ibm/aws/claude-haiku-5-5",
  };
  const emptySlots = {
    profileId: null,
    pair: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };
  const readBack = (
    primary: Record<string, string>,
    slot: Record<string, string> | null,
  ) => {
    const own = Object.fromEntries(
      Object.entries(primary).filter(
        ([id]) => !id.startsWith("platformSubagent."),
      ),
    );
    if (slot === null) return own;
    return {
      ...Object.fromEntries(
        Object.entries(own).filter(
          ([id]) => id !== "subagentModel" && id !== "subagentEffort",
        ),
      ),
      ...slot,
    };
  };

  /** TEST_SCENARIO: a profile pick that changes harness keeps the pair the server reads back: the platform slot the profile lends, the primary's values, and no derived native key, in the new session's payload too. */
  it("sends a profile pick that changes harness platform-level", () => {
    state.catalog = claudeCatalog;
    profilesState = [
      profile({
        name: "Deep review",
        harness: "claude-code",
        providerTemplate: "ibm-litellm",
        model: "ibm/aws/claude-opus-5-5",
        subagent: lent,
      }),
    ];
    const node = mount(
      picker({ carried: claude(), defaultHarness: "claude-code" }),
    );
    click(node, "Use a profile");
    profileRow(node, "Deep review");
    const [, stored, , , references, effective] = lastCall(state.remember);
    const slot = lentSubagentOfProfile(profilesState[0]!)!;
    expect(effective.settings).toEqual(readBack({}, slot));
    expect(effective.settings).not.toHaveProperty("subagentModel");
    expect(stored.settings).toBeUndefined();
    expect(references).toEqual({
      profileId: "p1",
      platformSubagentProfileId: null,
    });
    expect(lastCall(state.chosenModel)[1].settings).toEqual(readBack({}, slot));
  });

  /** TEST_SCENARIO: an own platform subagent is stored and shown platform-level, exactly as the server reads it back, with no native key in either the stored slots or the effective pair. */
  it("stores an own platform subagent platform-level", () => {
    state.catalog = claudeCatalog;
    state.chosen = {
      harness: "claude-code",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
    };
    const node = mount(
      picker({ carried: claude(), defaultHarness: "claude-code" }),
    );
    openMore(node);
    pickMenu(node, "Subagent model", "Claude Haiku 5.5");
    const [, stored, , , , effective] = lastCall(state.remember);
    const platform = {
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": "ibm/aws/claude-haiku-5-5",
    };
    expect(stored.settings).toEqual(readBack({}, platform));
    expect(effective.settings).toEqual(readBack({}, platform));
    expect(effective.settings).not.toHaveProperty("subagentModel");
  });

  /** TEST_SCENARIO: a profile that keeps its subagent effort lends it as the slot's platform effort, which the read-back pair carries as a platform key, not as a native `subagentEffort`. */
  it("lends an effort-bearing profile's subagent effort in the slot", () => {
    state.catalog = claudeCatalog;
    const deep = profile({
      name: "Deep review",
      harness: "claude-code",
      providerTemplate: "ibm-litellm",
      model: "ibm/aws/claude-opus-5-5",
      settings: { subagentEffort: "high" },
      subagent: {
        providerTemplate: "ibm-litellm",
        model: "ibm/aws/claude-haiku-5-5",
      },
    });
    profilesState = [deep];
    const node = mount(
      picker({ carried: claude(), defaultHarness: "claude-code" }),
    );
    click(node, "Use a profile");
    profileRow(node, "Deep review");
    const slot = lentSubagentOfProfile(deep)!;
    expect(slot["platformSubagent.effort"]).toBe("high");
    const [, , , , , effective] = lastCall(state.remember);
    expect(effective.settings).toEqual(readBack({}, slot));
    expect(effective.settings).not.toHaveProperty("subagentEffort");
    expect(lastCall(state.chosenModel)[1].settings).toEqual(readBack({}, slot));
  });

  /** TEST_SCENARIO: a legacy profile that names no subagent answers the read-back with its own native subagent model and effort in the primary, and no platform slot. */
  it("keeps a native-only legacy profile's subagent settings", () => {
    state.catalog = claudeCatalog;
    const native = {
      effort: "high",
      subagentModel: "ibm/aws/claude-haiku-5-5",
      subagentEffort: "low",
    };
    profilesState = [
      profile({
        name: "Legacy",
        harness: "claude-code",
        providerTemplate: "ibm-litellm",
        model: "ibm/aws/claude-opus-5-5",
        settings: native,
        subagent: null,
      }),
    ];
    const node = mount(
      picker({ carried: claude(), defaultHarness: "claude-code" }),
    );
    click(node, "Use a profile");
    profileRow(node, "Legacy");
    const [, , , , , effective] = lastCall(state.remember);
    expect(effective.settings).toEqual(readBack(native, null));
    expect(effective.settings).toMatchObject(native);
    expect(effective.settings?.["platformSubagent.model"]).toBeUndefined();
    expect(lastCall(state.chosenModel)[1].settings).toEqual(
      readBack(native, null),
    );
  });

  /** TEST_SCENARIO: a destination that keeps only values stores the read-back pair, the platform slot it lends with no derived native key, and never retains the profile reference. */
  it("keeps only values on a value-only destination", () => {
    state.catalog = claudeCatalog;
    profilesState = [
      profile({
        name: "Deep review",
        harness: "claude-code",
        providerTemplate: "ibm-litellm",
        model: "ibm/aws/claude-opus-5-5",
        subagent: lent,
      }),
    ];
    const target = {
      valueOnly: true,
      slots: emptySlots,
      label: "Model for channels",
      placeholder: "Use agent default",
      onChoose: vi.fn(),
    };
    const node = mount(
      picker({
        row: true,
        target,
        carried: claude(),
        defaultHarness: "claude-code",
      }),
    );
    click(node, "Use a profile");
    profileRow(node, "Deep review");
    const [stored, references, effective] = lastCall(target.onChoose);
    expect(references).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });
    const slot = lentSubagentOfProfile(profilesState[0]!)!;
    expect(stored.settings).toEqual(readBack({}, slot));
    expect(stored.settings).not.toHaveProperty("subagentModel");
    expect(effective).toEqual(stored);
  });

  /** TEST_SCENARIO: an own platform subagent survives a harness change that sends a model-less draft, keeping its platform values and no derived native key, and a later model pick keeps it. */
  it("keeps an own platform subagent through a harness draft", () => {
    state.catalog = claudeCatalog;
    const own: SessionPair = {
      harness: "claude-code",
      provider: "ibm",
      model: "ibm/aws/claude-opus-5-5",
      settings: {
        "platformSubagent.harness": "claude-code",
        "platformSubagent.model": lent.model,
        subagentModel: lent.model,
        subagentEffort: "low",
      },
    };
    state.chosen = own;
    const node = mount(
      picker({ carried: claude(), defaultHarness: "claude-code" }),
    );
    pickMenu(node, "Harness", "Pi");
    const [, draft] = lastCall(state.chosenModel) as [string, SessionPair];
    expect(draft).toMatchObject({ harness: "pi" });
    expect(draft.model).not.toBeNull();
    const piPlatform = {
      "platformSubagent.harness": "claude-code",
      "platformSubagent.model": lent.model,
    };
    expect(draft.settings).toEqual(readBack({}, piPlatform));
    expect(draft.settings?.subagentModel).toBeUndefined();
    expect(draft.settings?.subagentEffort).toBeUndefined();

    act(() => root!.unmount());
    root = null;
    container.remove();
    state.chosen = draft;
    state.catalog = routedCatalog;
    const second = mount(picker({ carried: claude(), defaultHarness: "pi" }));
    pickMenu(second, "Model", "Claude Opus 5.5");
    const [, stored] = lastCall(state.remember);
    expect(stored.settings).toEqual(readBack({}, piPlatform));
  });
});

describe("the reference draft's lifetime", () => {
  const lent = {
    providerTemplate: "curve-bender",
    model: "cb/rits/zai-org/glm-5-3",
  };
  const emptySlots = {
    profileId: null,
    pair: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };
  const defaultPair: SessionPair = {
    harness: "pi",
    provider: "ibm",
    model: "ibm/azure/gpt-5.5",
  };

  /** TEST_SCENARIO: a pick's reference draft has a lifetime: turning the page back to the agent's default clears it, so the parent's cleared slots are what the reopened picker shows. */
  it("drops the picked profile when inheritance is turned back on", () => {
    profilesState = [
      profile({
        name: "Fast review",
        model: "ibm/aws/claude-opus-5-5",
        providerTemplate: "ibm-litellm",
        subagent: lent,
      }),
    ];
    const onClear = vi.fn();
    const target = {
      slots: {
        ...emptySlots,
        pair: {
          harness: "pi",
          provider: "ibm",
          model: "ibm/aws/claude-haiku-5-5",
        },
      },
      label: "Default model",
      placeholder: "Choose a model",
      agentDefault: {
        active: false,
        summary: "GPT 5.5",
        harness: "pi",
        pair: defaultPair,
        onClear,
      },
      onChoose: vi.fn(),
    };
    const node = mount(picker({ row: true, target }));
    click(node, "Use a profile");
    profileRow(node, "Fast review");
    expect(lastCall(target.onChoose)[1]).toEqual({
      profileId: "p1",
      platformSubagentProfileId: null,
    });
    click(node, "Back to custom");

    const toggle = node.querySelector('[role="switch"]') as HTMLButtonElement;
    act(() => toggle.click());
    expect(onClear).toHaveBeenCalled();
    act(() =>
      root!.render(
        picker({
          row: true,
          target: {
            ...target,
            slots: emptySlots,
            agentDefault: { ...target.agentDefault, active: true, pair: null },
          },
        }),
      ),
    );
    expect(node.textContent).toContain("No default set yet.");
    expect(node.textContent).not.toContain("Fast review");
  });

  /** TEST_SCENARIO: a write that fails drops the draft, so the next subagent edit is not stored against a reference that was never saved. */
  it("drops the picked profile when the write fails", async () => {
    profilesState = [
      profile({
        name: "Fast review",
        model: "ibm/aws/claude-opus-5-5",
        providerTemplate: "ibm-litellm",
        subagent: lent,
      }),
    ];
    const target = {
      slots: {
        ...emptySlots,
        pair: {
          harness: "pi",
          provider: "ibm",
          model: "ibm/aws/claude-opus-5-5",
        },
      },
      label: "Default model",
      placeholder: "Choose a model",
      onChoose: vi.fn(async () => false),
    };
    const node = mount(picker({ row: true, target }));
    click(node, "Use a profile");
    profileRow(node, "Fast review");
    await act(async () => {});
    click(node, "Back to custom");
    pickMenu(node, "Subagent model", "Claude Opus 5.5");
    expect((lastCall(target.onChoose) as unknown[])[1]).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });
  });
});

describe("a value-only default replaced elsewhere", () => {
  const emptySlots = {
    profileId: null,
    pair: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };

  /** TEST_SCENARIO: a value-only page keeps a draft only against the pair it was built on, so a default replaced in another tab (new pair, no references) shows its new subagent instead of the draft's. */
  it("drops the draft when the stored pair changes", () => {
    const target = (pair: SessionPair) => ({
      valueOnly: true,
      slots: { ...emptySlots, pair },
      label: "Model for channels",
      placeholder: "Use agent default",
      onChoose: vi.fn(),
    });
    const node = mount(
      picker({
        row: true,
        target: target({
          harness: "pi",
          provider: "ibm",
          model: "ibm/aws/claude-opus-5-5",
        }),
      }),
    );
    openMore(node);
    pickMenu(node, "Subagent model", "Claude Haiku 5.5");

    act(() =>
      root!.render(
        picker({
          row: true,
          target: target({
            harness: "pi",
            provider: "ibm",
            model: "ibm/azure/gpt-5.5",
            settings: {
              "platformSubagent.harness": "pi",
              "platformSubagent.model": "cb/rits/zai-org/glm-5-3",
            },
          }),
        }),
      ),
    );
    expect(node.textContent).toContain("GPT 5.5");
    expect(menuTrigger(node, "subagent-model")).toContain("GLM 5.3");
  });
});

describe("a pending clear with the parent's old props", () => {
  const b = {
    "platformSubagent.harness": "pi",
    "platformSubagent.model": "ibm/aws/claude-opus-5-5",
    subagentModel: "ibm/aws/claude-opus-5-5",
    subagentEffort: "low",
  };

  /** TEST_SCENARIO: "Same as agent" takes effect at once even while the parent still passes the old pair: the body shows no subagent and a primary edit sends none of the old subagent's keys. */
  it("neither shows nor sends the old subagent", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
      settings: b,
    };
    const node = mount(picker());
    pickMenu(node, "Subagent model", "Same as agent");
    expect(
      node.querySelector('button[aria-labelledby$="-subagent-model-label"]'),
    ).toBeNull();
    pickMenu(node, "Model", "Claude Haiku 5.5");
    const [, stored] = lastCall(state.remember);
    expect(stored.settings?.["platformSubagent.model"]).toBeUndefined();
    expect(stored.settings?.subagentModel).toBeUndefined();
    expect(stored.settings?.subagentEffort).toBeUndefined();
  });
});

describe("a mounted picker switched to another agent", () => {
  /** TEST_SCENARIO: a draft belongs to the agent and destination it was picked on, so switching the mounted chat picker to an agent with empty slots shows and saves only that agent's own pick. */
  it("does not resurrect the other agent's draft", () => {
    state.chosen = {
      harness: "pi",
      provider: "ibm",
      model: "ibm/azure/gpt-5.5",
      settings: {
        "platformSubagent.harness": "pi",
        "platformSubagent.model": "ibm/aws/claude-opus-5-5",
      },
    };
    state.saved = undefined;
    const node = mount(picker({ agentId: "agent" }));
    pickMenu(node, "Subagent model", "Claude Haiku 5.5");
    expect(menuTrigger(node, "subagent-model")).toContain("Claude Haiku 5.5");

    state.chosen = null;
    act(() => root!.render(picker({ agentId: "agent-c" })));
    expect(menuTrigger(node, "model")).toBe("Choose a model");
    pickMenu(node, "Model", "Claude Haiku 5.5");
    const [, stored, , , references] = lastCall(state.remember);
    expect(references).toEqual({
      profileId: null,
      platformSubagentProfileId: null,
    });
    expect(stored.settings).toBeUndefined();
  });
});

describe("the older-versions toggle", () => {
  /** TEST_SCENARIO: with one menu open, the toggle acts in place: the menu stays open, focus stays on the toggle, and it selects nothing, whether clicked or pressed with Enter. The Model and subagent Model menus share this component. */
  it("keeps the menu open and focus on itself", () => {
    const onPick = vi.fn();
    function Host() {
      const [older, setOlder] = useState(false);
      return createElement(ValueMenu, {
        labelId: "toggle-label",
        menuLabel: "Model",
        display: "Alpha",
        currentKey: "alpha",
        sections: [
          {
            title: "",
            entries: older
              ? [
                  { key: "alpha", label: "Alpha" },
                  { key: "beta", label: "Beta" },
                ]
              : [{ key: "alpha", label: "Alpha" }],
          },
        ],
        foot: {
          label: older ? "Hide older versions" : "Show older versions",
          onSelect: () => setOlder(!older),
        },
        onPick,
      });
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Host)));
    const toggle = () =>
      [...container.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
        (item) => item.textContent?.includes("older versions"),
      )!;
    act(() => toggle().focus());
    act(() => toggle().click());
    expect(menu(container, "Model")).not.toBeNull();
    expect(document.activeElement).toBe(toggle());
    expect(onPick).not.toHaveBeenCalled();

    act(() =>
      toggle().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(menu(container, "Model")).not.toBeNull();
    expect(toggle().textContent).toContain("Show older versions");
    expect(document.activeElement).toBe(toggle());
    expect(onPick).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});

describe("a model's effort availability", () => {
  /** TEST_SCENARIO: a tier constraint (`haiku`) applies to the alias and its qualified forms, never to a concrete model that merely contains the word, so Claude Haiku 5.5 offers its effort. */
  it("matches a tier alias but not a concrete model", () => {
    const catalog = claudeCode.harnessConfigCatalog!;
    expect(modelConstraintsFor(catalog, "haiku")).toBeDefined();
    expect(modelConstraintsFor(catalog, "claude/haiku")).toBeDefined();
    expect(modelConstraintsFor(catalog, "anthropic/haiku")).toBeDefined();
    expect(
      modelConstraintsFor(catalog, "ibm/aws/claude-haiku-5-5"),
    ).toBeUndefined();
  });

  /** TEST_SCENARIO: a concrete model still takes a constraint keyed by its own id, provider-prefixed or with a date stamp, while a later model of the same family does not. */
  it("matches a concrete key by its name", () => {
    const catalog = {
      options: [],
      modelConstraints: { "claude-haiku-4-5": { effort: [] } },
    };
    expect(modelConstraintsFor(catalog, "ete/claude-haiku-4-5")).toEqual({
      effort: [],
    });
    expect(modelConstraintsFor(catalog, "claude-haiku-4-5")).toEqual({
      effort: [],
    });
    expect(
      modelConstraintsFor(catalog, "anthropic/claude-haiku-4-5-20251001"),
    ).toEqual({ effort: [] });
    expect(modelConstraintsFor(catalog, "claude/claude-haiku-4-5")).toEqual({
      effort: [],
    });
    expect(modelConstraintsFor(catalog, "claude-haiku-5-5")).toBeUndefined();
    expect(modelConstraintsFor(catalog, "claude-haiku-4-6")).toBeUndefined();
  });

  /** TEST_SCENARIO: every harness that has a thought-level setting leaves Claude Haiku 5.5 unconstrained; Hermes and Bob have none, so they show no Effort row at all. */
  it.each([
    ["claude-code", claudeCode],
    ["codex", claudeCode],
    ["pi", carried[0]!],
    ["copilot", claudeCode],
    ["hermes", claudeCode],
    ["bob", claudeCode],
  ])("leaves Claude Haiku 5.5 unconstrained on %s", (_name, capability) => {
    expect(
      modelConstraintsFor(
        capability.harnessConfigCatalog,
        "ibm/aws/claude-haiku-5-5",
      ),
    ).toBeUndefined();
  });

  /** TEST_SCENARIO: the picker offers Effort on Claude Haiku 5.5 for the harnesses that have a thought-level setting, and only a model constrained by its exact name shows the note. */
  it("offers effort on Claude Haiku 5.5", () => {
    state.catalog = claudeCatalog;
    state.chosen = {
      harness: "claude-code",
      provider: "ibm",
      model: "ibm/aws/claude-haiku-5-5",
    };
    const node = mount(
      picker({ carried: [claudeCode], defaultHarness: "claude-code" }),
    );
    openMore(node);
    expect(node.textContent).not.toContain("has no");
    expect(node.textContent).toContain("Effort");
    expect(menuItems(node, "Effort").length).toBeGreaterThan(0);
  });
});
