// @vitest-environment happy-dom
// TEST_OVERVIEW: The agent's configuration pages pick what its chats, channel turns and schedule fires run on. A channel and a schedule follow the default model until they pick their own, and their list's first row takes them back to it.
import type { HarnessCapability } from "agent-runtime-api";
import type {
  SessionChoiceReferences,
  SessionChoiceSlots,
  SessionPair,
} from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentModelPicker } from "../../modules/sandboxes/components/agent-model-picker.js";

type Target = {
  slots: SessionChoiceSlots;
  label: string;
  placeholder: string;
  agentDefault?: {
    summary: string;
    harness?: string | undefined;
    onClear: () => void;
  };
  onChoose: (pair: SessionPair, references: SessionChoiceReferences) => void;
};

const state = vi.hoisted(() => ({
  target: null as Target | null,
  row: false,
  close: null as (() => void) | null,
  saved: undefined as Record<string, unknown> | undefined,
  owned: true,
  remember: vi.fn(),
  clear: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({
  SessionPairPicker: (props: {
    target: Target;
    row?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => {
    state.target = props.target;
    state.row = props.row ?? false;
    state.close = props.onOpenChange ? () => props.onOpenChange?.(false) : null;
    return null;
  },
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useSessionDefaults: () => ({ data: state.saved }),
  useProviderConnections: () => ({
    owned: state.owned
      ? [{ id: "conn", name: "Anthropic", type: "anthropic" }]
      : [],
    granted: state.owned
      ? [{ id: "conn", name: "Anthropic", type: "anthropic" }]
      : [],
    loaded: true,
  }),
  rememberSessionPair: state.remember,
  clearSessionDefault: state.clear,
}));

const claude: HarnessCapability = {
  name: "claude-code",
  harnessConfig: true,
  sessionModel: true,
  sessionSettings: ["effort"],
  harnessConfigCatalog: {
    options: [
      {
        id: "effort",
        name: "Effort",
        category: "thought_level",
        default: "medium",
        choices: [
          { value: "medium", name: "medium" },
          { value: "high", name: "high" },
        ],
      },
    ],
  },
};

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: {
      harnesses: [claude],
      defaultHarness: "claude-code",
      modelRouter: true,
    },
  }),
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => ({ access: { role: "owner", editors: [], permissions: [] } }),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ navigateToSandboxHome: state.navigate }),
}));

const opus: SessionPair = {
  harness: "claude-code",
  provider: "conn",
  model: "anthropic/claude-opus-5-5",
};

let container: HTMLDivElement;
let root: Root;

const mount = (kind: "chat" | "channel" | "scheduled") => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(createElement(AgentModelPicker, { agentId: "a1", kind })),
  );
};

beforeEach(() => {
  state.owned = true;
  state.saved = {
    chat: opus,
    channel: null,
    scheduled: null,
    chatProfileId: null,
    platformSubagentProfileId: null,
    platformSubagentSettings: null,
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  state.target = null;
  state.close = null;
  vi.clearAllMocks();
});

describe("a channel's and a schedule's model", () => {
  /** TEST_SCENARIO: neither kind has a pick of its own, so its first row follows the default model and names the one it follows. */
  it.each([
    { kind: "channel" as const, label: "Model for channels" },
    { kind: "scheduled" as const, label: "Model for schedules" },
  ])("follows the default model on $kind until it picks", ({ kind, label }) => {
    mount(kind);
    expect(state.target!.slots.pair).toBeNull();
    expect(state.target!.label).toBe(label);
    expect(state.target!.agentDefault?.summary).toBe(
      "Claude Opus 5.5 · Medium (Anthropic)",
    );
    expect(state.target!.agentDefault?.harness).toBe("claude-code");
    expect(state.row).toBe(true);
    expect(container.textContent).toContain(label);
    expect(container.textContent).toContain(
      "that pick nothing of their own run on this.",
    );
  });

  /** TEST_SCENARIO: the row that follows the default clears the kind's own pick, so a later change of the default model reaches it. */
  it.each(["channel" as const, "scheduled" as const])(
    "clears the %s pick back to the default",
    (kind) => {
      state.saved = { ...state.saved, [kind]: opus };
      mount(kind);
      expect(state.target!.slots.pair).toEqual(opus);
      act(() => state.target!.agentDefault!.onClear());
      expect(state.clear).toHaveBeenCalledWith("a1", kind);
    },
  );

  /** TEST_SCENARIO: a model picked for the kind is stored as that kind's own default, with no profile reference, which only the chat default may name. */
  it.each(["channel" as const, "scheduled" as const])(
    "stores a pick as the %s default",
    (kind) => {
      mount(kind);
      const pair: SessionPair = {
        harness: "codex",
        provider: null,
        model: "openai/gpt-5.5",
      };
      act(() => state.target!.onChoose(pair, { profileId: "p1" }));
      expect(state.remember).toHaveBeenCalledWith(
        "a1",
        pair,
        kind,
        undefined,
        undefined,
      );
    },
  );

  /** TEST_SCENARIO: a harness picked before its model waits in the open picker alone, so closing the picker leaves the page's card on the pick that was saved. */
  it("drops an unsaved harness when the picker closes", () => {
    mount("scheduled");
    act(() =>
      state.target!.onChoose(
        { harness: "codex", provider: null, model: null },
        {},
      ),
    );
    expect(state.target!.slots.pair?.harness).toBe("codex");
    act(() => state.close!());
    expect(state.target!.slots.pair).toBeNull();
    expect(state.remember).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: a harness picked before its model waits in the picker, since a routed runtime keeps no default without a model. */
  it("waits for a model before it stores a new harness", () => {
    mount("scheduled");
    act(() =>
      state.target!.onChoose(
        { harness: "codex", provider: null, model: null },
        {},
      ),
    );
    expect(state.remember).not.toHaveBeenCalled();
    expect(state.target!.slots.pair?.harness).toBe("codex");
    const picked: SessionPair = {
      harness: "codex",
      provider: null,
      model: "openai/gpt-5.5",
    };
    act(() => state.target!.onChoose(picked, {}));
    expect(state.remember).toHaveBeenCalledWith(
      "a1",
      picked,
      "scheduled",
      undefined,
      undefined,
    );
  });
});

describe("the default model itself", () => {
  /** TEST_SCENARIO: the Providers page picks the model new chats start on, with no row to fall back to and the profile it names kept. */
  it("picks the chat default, references and all", () => {
    state.saved = { ...state.saved, chatProfileId: "p1" };
    mount("chat");
    expect(state.target!.agentDefault).toBeUndefined();
    expect(state.target!.placeholder).toBe("Choose a model");
    expect(state.target!.slots.profileId).toBe("p1");
    const references = { profileId: "p1", platformSubagentProfileId: null };
    act(() => state.target!.onChoose(opus, references));
    expect(state.remember).toHaveBeenCalledWith(
      "a1",
      opus,
      "chat",
      undefined,
      references,
    );
  });

  /** TEST_SCENARIO: an agent whose owner holds no provider has no model to offer, so the page shows no picker at all. */
  it("stays off the page when the agent has no provider", () => {
    state.owned = false;
    mount("chat");
    expect(state.target).toBeNull();
    expect(container.textContent).toBe("");
  });
});
