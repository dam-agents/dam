// @vitest-environment happy-dom
// TEST_OVERVIEW: the Browser Terminal button opens a menu of the harnesses a new web terminal can start with, the carried harnesses a provider fits, as menu items a keyboard reaches. Picking one stores the terminal's own pair and opens the terminal: the harness, with the first attached provider it accepts, and with no model and no settings, so the harness starts on its own default model. The chat picker's pair and the agent's chat default are neither copied nor changed. A harness that needs a provider first opens the attach dialog, which gives focus back to the button when it closes.
import type { SessionPair } from "api-server-api";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const anthropic = { id: "a", name: "Anthropic", type: "anthropic" as const };
  const ibm = { id: "i", name: "IBM LiteLLM", type: "ibm-litellm" as const };
  const openai = { id: "o", name: "OpenAI", type: "openai" as const };
  const picked = {
    harness: "claude-code",
    provider: "i",
    model: "i/claude-opus-4",
    settings: { effort: "high", profile: "reviewer" },
  };
  const catalog = [
    ["claude-code", "Claude", ["anthropic", "ibm-litellm"]],
    ["codex", "Codex", ["openai"]],
    ["bob", "Bob", ["bob"]],
    ["pi", "Pi", ["anthropic"]],
  ].map(([name, displayName, providers]) => ({
    name,
    displayName,
    providers,
    tags: [],
    experimental: false,
  }));
  return {
    anthropic,
    ibm,
    openai,
    picked,
    catalog,
    store: {
      nextSessionPair: { a1: picked },
      setNextSessionPair: vi.fn(),
      setNextTerminalPair: vi.fn(),
    },
    attachAll: vi.fn(),
    onOpen: vi.fn(),
  };
});

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select(fake.store),
}));
vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    isPending: false,
    isError: false,
    data: {
      harnesses: [{ name: "claude-code" }, { name: "codex" }, { name: "bob" }],
    },
  }),
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({
    isPending: false,
    isError: false,
    data: { harnesses: fake.catalog },
  }),
  useProviderConnections: () => ({
    granted: [fake.anthropic, fake.ibm],
    owned: [fake.anthropic, fake.ibm, fake.openai],
    loaded: true,
    failed: false,
  }),
  useGrantProvider: () => ({ attachAll: fake.attachAll }),
  useRememberedPair: () => ({ data: fake.picked }),
}));

const { TerminalHarnessMenu } =
  await import("../../modules/sessions/components/terminal-harness-menu.js");
const { pairMeta } =
  await import("../../modules/sessions/lib/session-pair-options.js");
const { terminalSocketUrl } =
  await import("../../modules/sessions/lib/terminal-socket.js");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(TerminalHarnessMenu, {
        agentId: "a1",
        onOpen: fake.onOpen,
        children: createElement(
          "button",
          { type: "button" },
          "Browser Terminal",
        ),
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const trigger = () => container.querySelector("button")!;
const items = () => [
  ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
];
const item = (name: string) => items().find((el) => el.textContent === name)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve)));

function openMenu() {
  act(() => {
    trigger().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
}

async function choose(name: string) {
  act(() => item(name).click());
  await settle();
}

async function press(key: string) {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

function storedPair(): SessionPair {
  expect(fake.store.setNextTerminalPair).toHaveBeenCalledOnce();
  const [agentId, pair] = fake.store.setNextTerminalPair.mock.calls[0] as [
    string,
    SessionPair,
  ];
  expect(agentId).toBe("a1");
  return pair;
}

// TEST_SCENARIO: the agent carries Claude, Codex and Bob. Claude has an attached provider, Codex one the owner can attach, and no provider fits Bob; Pi is in the catalog but not carried. The menu lists Claude and Codex and nothing else, and opening it opens no terminal.
it("lists exactly the harnesses the agent can run", () => {
  expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
  openMenu();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(items().map((el) => el.textContent)).toEqual(["Claude", "Codex"]);
  expect(fake.onOpen).not.toHaveBeenCalled();
});

// TEST_SCENARIO: a keyboard user opens the menu with the arrow key, moves down to the next harness, and Escape closes the menu and hands focus back to the button.
it("works from the keyboard and returns focus to the button", async () => {
  act(() => trigger().focus());
  await press("ArrowDown");
  expect(document.activeElement).toBe(item("Claude"));
  await press("ArrowDown");
  expect(document.activeElement).toBe(item("Codex"));
  await press("Escape");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

// TEST_SCENARIO: picking Claude opens a terminal on Claude with the first attached provider it accepts. The picker holds Claude on another provider with a model, an effort and a profile; none of them reaches the terminal, and the picker's pair is left as it was.
it("opens the terminal on the picked harness with no model or settings", async () => {
  openMenu();
  await choose("Claude");
  expect(storedPair()).toEqual({
    harness: "claude-code",
    provider: "a",
    model: null,
  });
  expect(fake.onOpen).toHaveBeenCalledOnce();
  expect(fake.store.setNextSessionPair).not.toHaveBeenCalled();
  const url = new URL(
    terminalSocketUrl({
      location: { protocol: "https:", host: "dam.test" },
      agentId: "a1",
      sessionId: "s1",
      token: "t",
      reset: false,
      wakes: true,
      lease: pairMeta(storedPair()),
    }),
  );
  expect([...url.searchParams.keys()].sort()).toEqual([
    "harness",
    "provider",
    "sessionId",
    "token",
  ]);
});

// TEST_SCENARIO: a keyboard user picks Codex, which no attached provider fits. The attach dialog takes focus; Escape closes it, opens no terminal, and gives focus back to the button rather than to the menu item that is gone.
it("gives focus back to the button when the attach dialog is cancelled", async () => {
  act(() => trigger().focus());
  await press("ArrowDown");
  await press("ArrowDown");
  await press("Enter");
  expect(dialog()?.textContent).toContain("Attach a provider for Codex");
  expect(dialog()?.contains(document.activeElement)).toBe(true);
  await press("Escape");
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  expect(fake.store.setNextTerminalPair).not.toHaveBeenCalled();
  expect(fake.onOpen).not.toHaveBeenCalled();
});

// TEST_SCENARIO: picking Codex and attaching the owner's OpenAI provider in the dialog opens the terminal on Codex with that provider and no model.
it("attaches a provider first for a harness that needs one", async () => {
  fake.attachAll.mockResolvedValue(true);
  openMenu();
  await choose("Codex");
  act(() => dialog()!.querySelector<HTMLElement>('[role="switch"]')!.click());
  const attach = [...dialog()!.querySelectorAll("button")].find(
    (b) => b.textContent === "Attach",
  )!;
  await act(async () => attach.click());
  expect(fake.attachAll).toHaveBeenCalledWith(["o"]);
  expect(storedPair()).toEqual({
    harness: "codex",
    provider: "o",
    model: null,
  });
  expect(fake.onOpen).toHaveBeenCalledOnce();
});
